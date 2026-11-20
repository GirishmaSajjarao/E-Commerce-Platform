import json
from pathlib import Path
import pytest
from app.database import SessionLocal
from app.models import EvalResult, TestRun
from app.seed import ORDERS, PRODUCTS
from app.services.runs import create_run

DATA = Path(__file__).resolve().parents[2] / "evaluation" / "datasets"
SCEN = json.loads((DATA / "scenarios.json").read_text(encoding="utf-8"))


def test_dataset_has_at_least_30_scenarios_with_required_fields():
    assert len(SCEN) >= 30
    assert len({s["key"] for s in SCEN}) == len(SCEN)
    for s in SCEN: assert s["question"].strip() and s["expected_answer"].strip() and "customer_id" in s


def test_dataset_covers_all_required_topics():
    cats = {s["category"] for s in SCEN}
    assert {"product_availability", "order_status", "order_tracking", "returns", "payment", "faq", "unsupported", "access_control", "unavailable_info"} <= cats


@pytest.mark.parametrize("pid,name,price,stock", [(p[0], p[1], p[4], p[5]) for p in PRODUCTS[:3]])
def test_expected_answers_match_seed_data(pid, name, price, stock):
    blob = " ".join(s["expected_answer"] for s in SCEN)
    assert name in blob


@pytest.mark.parametrize("framework", ["deepeval", "ragas"])
def test_frameworks_never_generate_scores_in_mock_mode(db, framework):
    from app.services.eval_deepeval import run_deepeval
    from app.services.eval_ragas import run_ragas
    run = create_run(db, framework, {"limit": 2}); rid = run.id
    (run_deepeval if framework == "deepeval" else run_ragas)(rid, 2)
    db.expire_all(); r = db.get(TestRun, rid)
    assert r.status == "skipped" and "No scores were generated" in r.message
    assert db.query(EvalResult).filter_by(run_id=rid).count() == 0


def test_deepeval_and_ragas_import():
    import deepeval, ragas
    from deepeval.metrics import AnswerRelevancyMetric, FaithfulnessMetric, HallucinationMetric, ContextualRelevancyMetric, ContextualPrecisionMetric, ContextualRecallMetric
    from ragas.metrics.collections import Faithfulness, AnswerRelevancy, ContextPrecision, ContextRecall


def test_promptfoo_configs_exist_and_cover_required_scenarios():
    text = (DATA.parent / "promptfoo" / "promptfooconfig.yaml").read_text(encoding="utf-8")
    for word in ("Normal", "Incorrect info", "Unsupported", "Injection", "Jailbreak", "Sensitive", "Refusal"): assert word in text
    assert (DATA.parent / "promptfoo" / "promptfooconfig.rubric.yaml").exists() and (DATA.parent / "promptfoo" / "provider.py").exists()


@pytest.mark.live_llm
def test_live_deepeval_smoke(db):
    """Runs 1 scenario with the REAL judge. Needs GEMINI_API_KEY."""
    from app.config import settings
    from app.services.eval_deepeval import run_deepeval
    settings.mock_mode, settings.gemini_api_key = False, __import__("conftest").REAL_KEY
    try:
        run = create_run(db, "deepeval", {"limit": 1}); run_deepeval(run.id, 1); db.expire_all()
        rows = db.query(EvalResult).filter_by(run_id=run.id).all()
        assert rows and all(r.error is None for r in rows), [r.error for r in rows]
        assert all(0 <= r.score <= 1 for r in rows)
    finally:
        settings.mock_mode, settings.gemini_api_key = True, ""
