"""DeepEval integration. Scores come straight from the DeepEval metric objects (LLM-as-judge via Gemini)."""
import asyncio, json, logging, os, re
from app.config import settings
from app.database import SessionLocal
from app.models import TestRun
from app.services import eval_common as ec
from app.services.llm import GeminiProvider, LLMError, real_llm_available
from app.services.runs import finish_run

os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
log = logging.getLogger(__name__)


def _json_text(txt: str) -> str:
    txt = txt.strip()
    m = re.search(r"\{.*\}|\[.*\]", txt, re.S)
    return m.group(0) if m else txt


def make_judge():
    from deepeval.models import DeepEvalBaseLLM

    class GeminiJudge(DeepEvalBaseLLM):
        def __init__(self):
            self.provider = GeminiProvider()
            super().__init__(model=settings.gemini_model)

        def load_model(self):
            return self.provider

        def generate(self, prompt: str, schema=None):
            if schema is None:
                return self.provider.complete(prompt)
            full = f"{prompt}\n\nReturn ONLY valid JSON that matches this JSON schema (no markdown):\n{json.dumps(schema.model_json_schema())}"
            return schema.model_validate_json(_json_text(self.provider.complete(full, json_mode=True)))

        async def a_generate(self, prompt: str, schema=None):
            return await asyncio.to_thread(self.generate, prompt, schema)

        def get_model_name(self):
            return f"gemini:{settings.gemini_model}"

    return GeminiJudge()


def build_metrics(judge):
    from deepeval.metrics import (AnswerRelevancyMetric, ContextualPrecisionMetric, ContextualRecallMetric,
                                  ContextualRelevancyMetric, FaithfulnessMetric, HallucinationMetric)
    c = dict(model=judge, async_mode=False, include_reason=True, verbose_mode=False)
    t, h = settings.eval_threshold, settings.hallucination_threshold
    return [("Answer Relevancy", AnswerRelevancyMetric(threshold=t, **c), t),
            ("Faithfulness", FaithfulnessMetric(threshold=t, **c), t),
            ("Hallucination", HallucinationMetric(threshold=h, **c), h),
            ("Contextual Relevancy", ContextualRelevancyMetric(threshold=t, **c), t),
            ("Contextual Precision", ContextualPrecisionMetric(threshold=t, **c), t),
            ("Contextual Recall", ContextualRecallMetric(threshold=t, **c), t)]


def run_deepeval(run_id: int, limit: int | None = None) -> None:
    db = SessionLocal()
    try:
        run = db.get(TestRun, run_id)
        ok, why = real_llm_available()
        if not ok:
            run.status = "skipped"
            finish_run(db, run, "skipped", f"DeepEval needs a real LLM judge. {why} No scores were generated.")
            return
        run.status = "running"; db.commit()
        from deepeval.test_case import LLMTestCase
        judge = make_judge()
        metrics = build_metrics(judge)
        scenarios = ec.load_scenarios(db, limit)
        run.total = len(scenarios) * len(metrics); db.commit()
        consecutive, abort = 0, None
        for sc in scenarios:
            try:
                actual, ctx = ec.run_chatbot(db, sc)
            except LLMError as e:
                run.errors += len(metrics)
                ec.save(db, run, "deepeval", sc, "chatbot", None, None, False, None, None, [], f"{e.code}: {e.message}")
                consecutive += 1
                abort = e.message if (ec.is_fatal(e) or consecutive >= ec.MAX_CONSECUTIVE_ERRORS) else None
                if abort: break
                continue
            case = LLMTestCase(input=sc["question"], actual_output=actual, expected_output=sc["expected_answer"],
                               retrieval_context=ctx, context=ctx)
            for name, metric, thr in metrics:
                try:
                    metric.measure(case)
                    passed = bool(metric.is_successful())
                    ec.save(db, run, "deepeval", sc, name, float(metric.score), thr, passed, metric.reason, actual, ctx)
                    run.passed += passed; run.failed += (not passed); consecutive = 0
                except Exception as e:                      # noqa: BLE001 - recorded, never swallowed
                    log.exception("DeepEval metric %s failed on %s", name, sc["key"])
                    run.errors += 1; consecutive += 1
                    ec.save(db, run, "deepeval", sc, name, None, thr, False, None, actual, ctx, f"{type(e).__name__}: {e}")
                    abort = ec.is_fatal(e) or (f"{ec.MAX_CONSECUTIVE_ERRORS} consecutive metric errors: {e}" if consecutive >= ec.MAX_CONSECUTIVE_ERRORS else None)
                    if abort: break
                db.commit()
            if abort: break
        if abort:
            finish_run(db, run, "failed", f"Stopped early: {abort}")
        else:
            finish_run(db, run, "completed_with_errors" if run.errors else "completed",
                       f"{run.errors} metric(s) errored; see error column." if run.errors else None)
    finally:
        db.close()
