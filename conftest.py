"""Root fixtures and plugins shared by all suites.
 - isolates tests from the real database (temporary SQLite files)
 - auto-assigns markers by folder
 - records every result into the results database so the dashboard can show history
"""
import os, socket, subprocess, sys, tempfile, time
from pathlib import Path
import pytest
import requests

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))

def _read_real_key() -> str:
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""

REAL_KEY = _read_real_key()
_tmp = Path(tempfile.mkdtemp(prefix="qa_tests_"))
os.environ.update({"DATABASE_URL": f"sqlite:///{(_tmp / 'inproc.db').as_posix()}", "MOCK_MODE": "true",
                   "SECRET_KEY": "test-secret-key", "GEMINI_API_KEY": ""})

FOLDER_MARKERS = {"tests/unit": "unit", "tests/integration": "integration", "tests/functional": "functional",
                  "tests/regression": "regression", "tests/llm_eval": "llm_eval", "tests/security": "security",
                  "api_tests": "api", "automation/tests": "ui"}
CATEGORIES = list(FOLDER_MARKERS.values())


def pytest_collection_modifyitems(config, items):
    for item in items:
        rel = Path(str(item.fspath)).resolve().relative_to(ROOT).as_posix()
        for folder, marker in FOLDER_MARKERS.items():
            if rel.startswith(folder):
                item.add_marker(getattr(pytest.mark, marker))
        if item.get_closest_marker("live_llm") and not REAL_KEY:
            item.add_marker(pytest.mark.skip(reason="Needs a real LLM: set GEMINI_API_KEY in .env (live tests also force MOCK_MODE=false)."))


# ---------- result recording ----------
@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    if "page" in item.funcargs and rep.when == "call" and rep.failed:       # Playwright: screenshot + console errors
        try:
            shots = ROOT / "reports" / "screenshots"; shots.mkdir(parents=True, exist_ok=True)
            path = shots / (item.name + ".png")
            item.funcargs["page"].screenshot(path=str(path), full_page=True)
            rep.user_properties.append(("screenshot", str(path)))
        except Exception as e:                                                 # noqa: BLE001
            rep.user_properties.append(("screenshot_error", str(e)))
        errs = getattr(item.funcargs["page"], "console_errors", [])
        if errs:
            rep.user_properties.append(("console_errors", errs[:10]))
    if os.environ.get("RECORD_RESULTS", "1") == "0":
        return
    if rep.when == "call" or (rep.when == "setup" and rep.outcome != "passed"):
        cat = next((m.name for m in item.iter_markers() if m.name in CATEGORIES), "unit")
        status = "passed" if rep.passed else "skipped" if rep.skipped else ("error" if rep.when == "setup" else "failed")
        err = str(rep.longrepr)[-1500:] if rep.failed else (str(rep.longrepr[2]) if rep.skipped and isinstance(rep.longrepr, tuple) else None)
        details = dict(rep.user_properties) or None
        try:
            from app.services.recorder import record_test
            rid = os.environ.get("RECORD_RUN_ID")
            record_test(cat, item.nodeid, status, rep.duration * 1000, err, details, int(rid) if rid else None)
        except Exception as e:                                                 # noqa: BLE001 - never break tests because of recording
            print(f"[recorder] could not store result: {e}")


# ---------- in-process app fixtures ----------
@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def db():
    from app.database import SessionLocal, Base, engine
    import app.models  # noqa: F401
    from app.seed import seed_db
    Base.metadata.create_all(engine)
    s = SessionLocal(); seed_db(s)
    try:
        yield s
    finally:
        s.close()


def login(client, email, password):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


@pytest.fixture(scope="session")
def alice(client):
    return login(client, "alice@example.com", "Customer@123")


@pytest.fixture(scope="session")
def bob(client):
    return login(client, "bob@example.com", "Customer@123")


@pytest.fixture(scope="session")
def admin(client):
    return login(client, "admin@qa.local", "Admin@123")


# ---------- live server (API + UI tests) ----------
def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); return s.getsockname()[1]


@pytest.fixture(scope="session")
def live_server():
    port = _free_port()
    db_file = _tmp / "live.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db_file.as_posix()}", "MOCK_MODE": "true", "GEMINI_API_KEY": "",
           "RESULTS_DATABASE_URL": f"sqlite:///{db_file.as_posix()}"}
    (ROOT / "logs").mkdir(exist_ok=True)
    logf = open(ROOT / "logs" / "test_server.log", "w")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port), "--log-level", "warning"],
                            cwd=ROOT / "backend", env=env, stdout=logf, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(60):
        try:
            if requests.get(url + "/api/health", timeout=1).status_code == 200:
                break
        except requests.RequestException:
            time.sleep(0.5)
    else:
        proc.kill()
        pytest.fail(f"Test server did not start. See logs/test_server.log")
    yield url
    proc.terminate()
    try: proc.wait(10)
    except subprocess.TimeoutExpired: proc.kill()
