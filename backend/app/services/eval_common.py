"""Shared pieces for DeepEval and Ragas runs: scenario loading, chatbot execution, result persistence."""
import logging
from app.models import EvalResult, TestCase
from app.services.chat import answer_question
from app.services.llm import LLMError

log = logging.getLogger(__name__)
NO_CONTEXT = "No relevant information was retrieved from the store systems."
MAX_CONSECUTIVE_ERRORS = 3


def load_scenarios(db, limit=None):
    rows = db.query(TestCase).filter(TestCase.suite == "evaluation", TestCase.enabled.is_(True)).order_by(TestCase.key).all()
    return [r.payload for r in rows][: limit or None]


def run_chatbot(db, scenario: dict):
    """Real pipeline: retrieval + LLM. Returns (actual_output, contexts[list[str]]). Raises LLMError."""
    ans = answer_question(db, scenario["question"], scenario.get("customer_id"))
    return ans.raw, (ans.context_texts or [NO_CONTEXT])


def save(db, run, framework, scenario, metric, score, threshold, passed, reason, actual, contexts, error=None, is_mock=False):
    db.add(EvalResult(run_id=run.id, framework=framework, scenario_key=scenario["key"], metric=metric, score=score,
                      threshold=threshold, passed=bool(passed), reason=(reason or None) and str(reason)[:2000],
                      question=scenario["question"], expected_output=scenario.get("expected_answer"),
                      retrieved_context=contexts, actual_output=actual, error=error, is_mock=is_mock))
    db.commit()


def is_fatal(exc: Exception) -> str | None:
    """Returns a readable message when the exception means the whole run cannot continue (bad key, quota, ...)."""
    from app.services.runs import FATAL_LLM_CODES
    e = exc
    while e is not None:
        if isinstance(e, LLMError) and e.code in FATAL_LLM_CODES:
            return e.message
        e = e.__cause__ or e.__context__
    return None
