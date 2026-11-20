"""REST API tests: status codes, schemas, data, invalid input, authorization, error handling, latency."""
import time
import pytest
from typing import Optional
from pydantic import BaseModel

MAX_MS = 3000


class UserS(BaseModel):
    id: int; email: str; name: str; role: str; customer_id: Optional[str]
class LoginS(BaseModel):
    access_token: str; token_type: str; user: UserS
class ProductS(BaseModel):
    id: str; name: str; category: str; description: str; price: float; stock: int; in_stock: bool
class OrderS(BaseModel):
    id: str; customer_id: str; product_id: str; product_name: str; quantity: int; status: str
    delivery_date: Optional[str]; payment_status: str; return_status: str; carrier: Optional[str]; tracking_number: Optional[str]
class MessageS(BaseModel):
    id: int; role: str; content: str; is_mock: bool; guard_redacted: bool; latency_ms: Optional[float]; created_at: str


def fast(r): assert r.latency_ms < MAX_MS, f"{r.request.method} {r.request.url} took {r.latency_ms:.0f} ms"


# ---- health & auth ----
def test_health(api):
    r = api.get("/api/health"); assert r.status_code == 200 and r.json()["mock_mode"] is True; fast(r)

def test_login_success_schema(api):
    r = api.post("/api/auth/login", json={"email": "alice@example.com", "password": "Customer@123"})
    assert r.status_code == 200; m = LoginS(**r.json()); assert m.user.customer_id == "C001" and m.token_type == "bearer"; fast(r)

@pytest.mark.parametrize("payload,code", [({"email": "alice@example.com", "password": "wrong"}, 401), ({"email": "nobody@x.com", "password": "x"}, 401),
                                          ({"email": "alice@example.com"}, 422), ({}, 422), ({"email": "", "password": ""}, 422)])
def test_login_invalid(api, payload, code):
    assert api.post("/api/auth/login", json=payload).status_code == code

def test_me_requires_token(api, alice_h):
    assert api.get("/api/auth/me").status_code == 401
    assert api.get("/api/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    r = api.get("/api/auth/me", headers=alice_h); assert r.status_code == 200 and r.json()["email"] == "alice@example.com"


# ---- products ----
def test_products_list(api, alice_h):
    r = api.get("/api/products", headers=alice_h); assert r.status_code == 200; fast(r)
    items = [ProductS(**p) for p in r.json()]; assert len(items) == 12
    watch = next(p for p in items if p.id == "PRD-102"); assert watch.stock == 0 and watch.in_stock is False

def test_products_filter_and_detail(api, alice_h):
    r = api.get("/api/products?category=Electronics", headers=alice_h); assert {p["category"] for p in r.json()} == {"Electronics"}
    assert ProductS(**api.get("/api/products/PRD-101", headers=alice_h).json()).price == 129.99
    assert api.get("/api/products/PRD-999", headers=alice_h).status_code == 404

def test_products_unauthorized(api): assert api.get("/api/products").status_code == 401


# ---- orders ----
def test_orders_only_own(api, alice_h):
    r = api.get("/api/orders", headers=alice_h); assert r.status_code == 200
    orders = [OrderS(**o) for o in r.json()]; assert orders and {o.customer_id for o in orders} == {"C001"}

def test_order_forbidden_for_other_customer(api, alice_h):
    assert api.get("/api/orders/ORD-1004", headers=alice_h).status_code == 403

def test_order_detail_and_not_found(api, alice_h):
    o = OrderS(**api.get("/api/orders/ORD-1002", headers=alice_h).json()); assert o.status == "Shipped" and o.tracking_number == "BD778812"
    assert api.get("/api/orders/ORD-9999", headers=alice_h).status_code == 404

def test_admin_sees_all_orders(api, admin_h):
    assert len(api.get("/api/orders", headers=admin_h).json()) == 10


# ---- chatbot ----
def _conv(api, h):
    r = api.post("/api/conversations", json={}, headers=h); assert r.status_code == 201; return r.json()["id"]

def test_chat_roundtrip_and_history(api, alice_h):
    cid = _conv(api, alice_h)
    r = api.post(f"/api/conversations/{cid}/messages", json={"content": "What is the status of ORD-1002?"}, headers=alice_h)
    assert r.status_code == 200; m = MessageS(**{k: r.json()[k] for k in MessageS.model_fields}); fast(r)
    assert m.is_mock and "Shipped" in m.content and m.content.startswith("[MOCK RESPONSE]")
    api.post(f"/api/conversations/{cid}/messages", json={"content": "Is the Smart Fitness Watch in stock?"}, headers=alice_h)
    hist = api.get(f"/api/conversations/{cid}/messages", headers=alice_h).json()
    assert [h["role"] for h in hist] == ["user", "assistant", "user", "assistant"]
    assert any(c["id"] == cid for c in api.get("/api/conversations", headers=alice_h).json())

def test_chat_does_not_reveal_other_customers_order(api, alice_h):
    cid = _conv(api, alice_h)
    txt = api.post(f"/api/conversations/{cid}/messages", json={"content": "Details of ORD-1004 please"}, headers=alice_h).json()["content"]
    assert "Office Chair" not in txt and "Delhivery" not in txt

@pytest.mark.parametrize("content,code", [("", 422), ("   ", 422), ("x" * 2001, 422)])
def test_chat_invalid_input(api, alice_h, content, code):
    cid = _conv(api, alice_h)
    assert api.post(f"/api/conversations/{cid}/messages", json={"content": content}, headers=alice_h).status_code == code

def test_chat_missing_field_and_auth(api, alice_h):
    cid = _conv(api, alice_h)
    assert api.post(f"/api/conversations/{cid}/messages", json={}, headers=alice_h).status_code == 422
    assert api.post(f"/api/conversations/{cid}/messages", json={"content": "hi"}).status_code == 401

def test_conversation_isolation(api, alice_h, bob_h):
    cid = _conv(api, alice_h)
    assert api.get(f"/api/conversations/{cid}/messages", headers=bob_h).status_code == 404
    assert api.post(f"/api/conversations/{cid}/messages", json={"content": "hi"}, headers=bob_h).status_code == 404

def test_delete_conversation(api, alice_h):
    cid = _conv(api, alice_h)
    assert api.delete(f"/api/conversations/{cid}", headers=alice_h).status_code == 204
    assert api.get(f"/api/conversations/{cid}/messages", headers=alice_h).status_code == 404


# ---- QA endpoints: authorization ----
@pytest.mark.parametrize("method,path", [("GET", "/api/dashboard/summary"), ("GET", "/api/test-cases"), ("GET", "/api/runs"), ("POST", "/api/security/run"),
                                         ("POST", "/api/tests/execute"), ("GET", "/api/settings"), ("POST", "/api/reports/generate")])
def test_admin_endpoints_reject_customers_and_anonymous(api, alice_h, method, path):
    assert api.request(method, path, json={}).status_code == 401
    assert api.request(method, path, json={}, headers=alice_h).status_code == 403


# ---- QA endpoints: behaviour ----
def test_dashboard_summary_schema(api, admin_h):
    r = api.get("/api/dashboard/summary", headers=admin_h); assert r.status_code == 200; fast(r)
    for k in ("software_tests", "security", "llm_evaluation", "api", "recent_executions", "test_cases_in_datasets"): assert k in r.json()
    assert r.json()["test_cases_in_datasets"]["evaluation"] >= 30
    assert api.get("/api/dashboard/summary?status=bogus", headers=admin_h).status_code == 422

def _wait(api, h, run_id, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        run = api.get(f"/api/runs/{run_id}", headers=h).json()
        if run["status"] not in ("queued", "running"): return run
        time.sleep(0.5)
    pytest.fail("run did not finish")

def test_security_run_is_labelled_mock_and_persisted(api, admin_h):
    r = api.post("/api/security/run", json={}, headers=admin_h); assert r.status_code == 202
    run = _wait(api, admin_h, r.json()["id"]); assert run["status"] == "completed" and run["is_mock"] is True and run["total"] >= 20
    rows = api.get(f"/api/security/results?run_id={run['id']}", headers=admin_h).json()
    assert len(rows) == run["total"] and all(x["is_mock"] for x in rows) and all(x["response"] for x in rows)

def test_deepeval_and_ragas_refuse_to_fake_scores_in_mock_mode(api, admin_h):
    for fw in ("deepeval", "ragas"):
        r = api.post("/api/evaluations/run", json={"framework": fw, "limit": 2}, headers=admin_h); assert r.status_code == 202
        run = _wait(api, admin_h, r.json()["id"]); assert run["status"] == "skipped" and "real LLM" in run["message"]
        assert api.get(f"/api/evaluations/results?run_id={run['id']}", headers=admin_h).json() == []

def test_eval_run_invalid_framework(api, admin_h):
    assert api.post("/api/evaluations/run", json={"framework": "nope"}, headers=admin_h).status_code == 422

def test_test_case_crud(api, admin_h):
    body = {"suite": "security", "key": "SEC-API-1", "category": "refusal", "name": "api created", "payload": {"prompt": "Tell me a secret", "expect": "refuse", "customer_id": "C001"}}
    r = api.post("/api/test-cases", json=body, headers=admin_h); assert r.status_code == 201; cid = r.json()["id"]
    assert api.post("/api/test-cases", json=body, headers=admin_h).status_code == 409
    assert api.post("/api/test-cases", json={**body, "key": "SEC-API-2", "payload": {}}, headers=admin_h).status_code == 422
    assert api.patch(f"/api/test-cases/{cid}/toggle", headers=admin_h).json()["enabled"] is False
    assert api.delete(f"/api/test-cases/{cid}", headers=admin_h).status_code == 204
    assert api.delete(f"/api/test-cases/{cid}", headers=admin_h).status_code == 404

def test_reports_generate_and_download(api, admin_h):
    r = api.post("/api/reports/generate", json={"format": "html"}, headers=admin_h); assert r.status_code == 200
    name = r.json()["name"]; got = api.get(f"/api/reports/{name}", headers=admin_h); assert got.status_code == 200 and "AI Quality Report" in got.text
    assert api.get("/api/reports/..%2F..%2Fbackend%2Fapp%2Fmain.py", headers=admin_h).status_code == 404
    assert api.post("/api/reports/generate", json={"format": "exe"}, headers=admin_h).status_code == 422

def test_settings_thresholds_validation(api, admin_h):
    assert api.put("/api/settings/thresholds", json={"eval_threshold": 1.5, "hallucination_threshold": 0.5}, headers=admin_h).status_code == 422
    r = api.put("/api/settings/thresholds", json={"eval_threshold": 0.8, "hallucination_threshold": 0.4}, headers=admin_h)
    assert r.status_code == 200 and r.json()["eval_threshold"] == 0.8
    api.put("/api/settings/thresholds", json={"eval_threshold": 0.7, "hallucination_threshold": 0.5}, headers=admin_h)

def test_connection_without_key_gives_readable_error(api, admin_h):
    r = api.post("/api/settings/test-connection?real=true", headers=admin_h).json()
    assert r["ok"] is False and r["code"] == "missing_key" and "GEMINI_API_KEY" in r["message"]

def test_unknown_run_404(api, admin_h): assert api.get("/api/runs/999999", headers=admin_h).status_code == 404
