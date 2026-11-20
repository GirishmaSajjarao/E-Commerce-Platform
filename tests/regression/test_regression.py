"""Rules that must never regress."""
import pytest
from app.services import chat as chat_svc, llm
from app.services.retrieval import describe_order
from app.models import Order, Product


def test_processing_order_never_gets_a_delivery_date(db):
    o = db.get(Order, "ORD-1003"); assert o.delivery_date is None and "delivery date: not available" in describe_order(o)


def test_shipped_delivery_date_is_labelled_estimated(db):
    assert "estimated delivery date: 2026-11-07" in describe_order(db.get(Order, "ORD-1002"))


def test_private_fields_never_reach_prompt_context(db):
    from app.services.retrieval import retrieve
    blob = " ".join(c["text"] for c in retrieve(db, "orders ORD-1001 ORD-1002 ORD-1003 my order", "C001"))
    assert "@" not in blob and "+1-555" not in blob and "alice" not in blob.lower()


def test_system_prompt_forbids_leaks_and_never_hardcodes_keys():
    assert "never reveal" in llm.SYSTEM_PROMPT.lower() and "AIza" not in llm.SYSTEM_PROMPT


def test_pii_in_raw_model_output_is_redacted_for_customers(client, alice, monkeypatch):
    class Leaky(llm.MockProvider):
        def generate(self, *a, **k): return "Sure, contact bob@example.com or +1-555-0102"
    monkeypatch.setattr(chat_svc, "get_provider", lambda force_real=False: Leaky())
    cid = client.post("/api/conversations", json={}, headers=alice).json()["id"]
    m = client.post(f"/api/conversations/{cid}/messages", json={"content": "contact?"}, headers=alice).json()
    assert "bob@example.com" not in m["content"] and "555" not in m["content"] and m["guard_redacted"] is True


def test_api_key_value_never_returned_by_settings(client, admin, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "gemini_api_key", "SECRET-KEY-VALUE-123")
    r = client.get("/api/settings", headers=admin)
    assert r.status_code == 200 and "SECRET-KEY-VALUE-123" not in r.text and r.json()["api_key_configured"] is True


def test_frontend_contains_no_api_keys():
    from pathlib import Path
    for p in (Path(__file__).resolve().parents[2] / "frontend").rglob("*.js"):
        if p.name != "chart.umd.js": assert "AIza" not in p.read_text(encoding="utf-8", errors="ignore")
