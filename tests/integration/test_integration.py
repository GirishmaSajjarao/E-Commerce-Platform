import json
import pytest
from sqlalchemy import text, inspect
from app.database import engine, SessionLocal
from app.models import Message, ExecutionRecord, SecurityResult, EvalResult
from app.services import chat as chat_svc, llm
from app.services.llm import LLMError


def mk(client, h):
    return client.post("/api/conversations", json={}, headers=h).json()["id"]


def test_multi_turn_followup_uses_history(client, alice):
    cid = mk(client, alice)
    client.post(f"/api/conversations/{cid}/messages", json={"content": "Where is ORD-1002?"}, headers=alice)
    r = client.post(f"/api/conversations/{cid}/messages", json={"content": "What is the tracking number?"}, headers=alice).json()
    assert "BD778812" in r["content"]


def test_llm_failure_returns_readable_502_and_keeps_user_message(client, alice, monkeypatch):
    class Boom(llm.MockProvider):
        def generate(self, *a, **k): raise LLMError("invalid_key", "Gemini rejected the API key (403). Check GEMINI_API_KEY in .env.")
    monkeypatch.setattr(chat_svc, "get_provider", lambda force_real=False: Boom())
    cid = mk(client, alice)
    r = client.post(f"/api/conversations/{cid}/messages", json={"content": "hello"}, headers=alice)
    assert r.status_code == 502 and r.json()["detail"]["code"] == "invalid_key" and "GEMINI_API_KEY" in r.json()["detail"]["message"]
    hist = client.get(f"/api/conversations/{cid}/messages", headers=alice).json(); assert [m["role"] for m in hist] == ["user"]


def test_admin_impersonation_only_for_admin(client, alice, admin):
    cid = mk(client, alice)
    txt = client.post(f"/api/conversations/{cid}/messages", json={"content": "ORD-1004?", "as_customer_id": "C002"}, headers=alice).json()["content"]
    assert "Office Chair" not in txt                                         # customers cannot impersonate
    cid = mk(client, admin)
    txt = client.post(f"/api/conversations/{cid}/messages", json={"content": "ORD-1004?", "as_customer_id": "C002"}, headers=admin).json()["content"]
    assert "Office Chair" in txt


def test_sql_integrity_checks(db):
    q = lambda sql: db.execute(text(sql)).scalar()
    assert q("SELECT COUNT(*) FROM orders o LEFT JOIN users u ON u.customer_id=o.customer_id WHERE u.id IS NULL") == 0
    assert q("SELECT COUNT(*) FROM orders o LEFT JOIN products p ON p.id=o.product_id WHERE p.id IS NULL") == 0
    assert q("SELECT COUNT(*) FROM (SELECT email FROM users GROUP BY email HAVING COUNT(*)>1)") == 0
    assert q("SELECT COUNT(*) FROM products WHERE stock < 0 OR price <= 0") == 0
    assert q("SELECT COUNT(*) FROM orders WHERE status IN ('Processing','Cancelled') AND delivery_date IS NOT NULL") == 0
    assert q("SELECT COUNT(*) FROM messages m LEFT JOIN conversations c ON c.id=m.conversation_id WHERE c.id IS NULL") == 0
    assert q("SELECT COUNT(*) FROM test_cases WHERE suite='evaluation'") >= 30


def test_seeding_is_idempotent(db):
    from app.seed import seed_db
    before = db.execute(text("SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM orders),(SELECT COUNT(*) FROM test_cases)")).one()
    seed_db(db)
    assert db.execute(text("SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM orders),(SELECT COUNT(*) FROM test_cases)")).one() == before


def test_results_persist_after_engine_restart(db):
    db.add(SecurityResult(run_id=_run(db), case_key="PERSIST", category="refusal", prompt="p", response="r", passed=True)); db.commit()
    engine.dispose()                                                         # simulates an application restart
    s = SessionLocal()
    try: assert s.query(SecurityResult).filter_by(case_key="PERSIST").count() == 1
    finally: s.close()


def _run(db):
    from app.services.runs import create_run
    return create_run(db, "security", {}).id


def test_dashboard_counts_come_from_stored_records(client, admin, db):
    db.add_all([ExecutionRecord(category="unit", name="t::a", status="passed", duration_ms=1), ExecutionRecord(category="unit", name="t::b", status="failed", duration_ms=1, error="boom")]); db.commit()
    s = client.get("/api/dashboard/summary?category=unit", headers=admin).json()["software_tests"]
    assert s["passed"] >= 1 and s["failed"] >= 1 and s["total"] == s["passed"] + s["failed"] + s["skipped"]
    assert client.get("/api/dashboard/summary?category=unit&status=failed", headers=admin).json()["software_tests"]["passed"] == 0


def test_llm_scores_are_separated_from_pass_rates(client, admin, db):
    rid = _run(db)
    db.add_all([EvalResult(run_id=rid, framework="deepeval", scenario_key="X", metric="Faithfulness", score=0.9, threshold=0.7, passed=True),
                EvalResult(run_id=rid, framework="deepeval", scenario_key="X", metric="Hallucination", score=0.8, threshold=0.5, passed=False),
                EvalResult(run_id=rid, framework="ragas", scenario_key="X", metric="faithfulness", score=0.5, threshold=0.7, passed=False)]); db.commit()
    ev = client.get("/api/dashboard/summary?framework=deepeval", headers=admin).json()["llm_evaluation"]
    assert set(ev["frameworks"]) == {"deepeval"} and ev["hallucinations_detected"] >= 1
    cmp = client.get("/api/evaluations/compare", headers=admin).json(); assert "faithfulness" in cmp and "deepeval" in cmp["faithfulness"] and "ragas" in cmp["faithfulness"]
