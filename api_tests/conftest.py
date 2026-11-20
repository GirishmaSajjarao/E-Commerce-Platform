import os, time
import pytest, requests
from app.services.recorder import record_api_call

CURRENT = {"test": None}


class RecordingSession(requests.Session):
    """requests.Session that stores method/path/status/latency of every call for the dashboard."""
    def __init__(self, base_url):
        super().__init__(); self.base_url = base_url

    def request(self, method, url, **kw):
        kw.setdefault("timeout", 30)
        t = time.perf_counter()
        resp = super().request(method, self.base_url + url if url.startswith("/") else url, **kw)
        ms = (time.perf_counter() - t) * 1000
        resp.latency_ms = ms
        if os.environ.get("RECORD_RESULTS", "1") != "0":
            try:
                rid = os.environ.get("RECORD_RUN_ID")
                record_api_call(method.upper(), url.split("?")[0], resp.status_code, ms, CURRENT["test"], int(rid) if rid else None)
            except Exception as e:  # noqa: BLE001
                print("[recorder] api call not stored:", e)
        return resp


@pytest.fixture(autouse=True)
def _name(request):
    CURRENT["test"] = request.node.nodeid


@pytest.fixture(scope="session")
def api(live_server):
    return RecordingSession(live_server)


def _token(api, email, pw):
    r = api.post("/api/auth/login", json={"email": email, "password": pw}); assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


@pytest.fixture(scope="session")
def admin_h(api): return _token(api, "admin@qa.local", "Admin@123")
@pytest.fixture(scope="session")
def alice_h(api): return _token(api, "alice@example.com", "Customer@123")
@pytest.fixture(scope="session")
def bob_h(api): return _token(api, "bob@example.com", "Customer@123")
