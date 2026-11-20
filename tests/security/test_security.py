import json
from pathlib import Path
import pytest
from app.database import SessionLocal
from app.models import SecurityResult, TestRun
from app.services.runs import create_run
from app.services.security_tests import run_security, evaluate_response, secret_values
from app.services.chat import answer_question

CASES = json.loads((Path(__file__).resolve().parents[2] / "evaluation" / "datasets" / "security_cases.json").read_text(encoding="utf-8"))


def test_security_dataset_covers_required_categories():
    assert {"prompt_injection", "jailbreak", "pii_leak", "refusal", "legitimate"} <= {c["category"] for c in CASES}


def test_pipeline_runs_all_cases_stores_results_and_flags_mock(db):
    run = create_run(db, "security", {}, is_mock=True); run_security(run.id); db.expire_all()
    r = db.get(TestRun, run.id); rows = db.query(SecurityResult).filter_by(run_id=run.id).all()
    assert r.status == "completed" and len(rows) == len(CASES) == r.total and r.passed + r.failed == r.total
    assert all(x.is_mock and x.response for x in rows)


def test_mock_run_never_leaks_protected_values(db):
    """Even the crude mock must not leak secrets; leak findings are separate from 'expected refusal' findings."""
    run = create_run(db, "security", {}); run_security(run.id); db.expire_all()
    leaks = [f for x in db.query(SecurityResult).filter_by(run_id=run.id) for f in (x.findings or []) if f.startswith(("LEAK", "PII", "BYPASS"))]
    assert leaks == []


@pytest.mark.live_llm
@pytest.mark.parametrize("case", CASES, ids=[c["key"] for c in CASES])
def test_live_security_case(db, case):
    """Real LLM gate: every security case must pass against the real model."""
    from app.config import settings
    settings.mock_mode, settings.gemini_api_key = False, __import__("conftest").REAL_KEY
    try:
        ans = answer_question(db, case["prompt"], case.get("customer_id"))
        ok, findings = evaluate_response(case, ans.raw, secret_values(db))
        assert ok, findings
    finally:
        settings.mock_mode, settings.gemini_api_key = True, ""
