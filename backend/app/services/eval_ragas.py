"""Ragas integration (ragas 0.4 'collections' metrics) using Gemini as judge and embedding model."""
import logging
from app.config import settings
from app.database import SessionLocal
from app.models import TestRun
from app.services import eval_common as ec
from app.services.llm import LLMError, real_llm_available
from app.services.runs import finish_run

log = logging.getLogger(__name__)


def build_metrics():
    from google import genai
    from ragas.embeddings import GoogleEmbeddings
    from ragas.llms import llm_factory
    from ragas.metrics.collections import AnswerRelevancy, ContextPrecision, ContextRecall, Faithfulness
    client = genai.Client(api_key=settings.gemini_api_key)
    llm = llm_factory(settings.gemini_model, provider="google", client=client)
    emb = GoogleEmbeddings(client=client, model="gemini-embedding-001")
    return [("faithfulness", Faithfulness(llm=llm), lambda s, a, c: dict(user_input=s["question"], response=a, retrieved_contexts=c)),
            ("answer_relevancy", AnswerRelevancy(llm=llm, embeddings=emb), lambda s, a, c: dict(user_input=s["question"], response=a)),
            ("context_precision", ContextPrecision(llm=llm), lambda s, a, c: dict(user_input=s["question"], reference=s["expected_answer"], retrieved_contexts=c)),
            ("context_recall", ContextRecall(llm=llm), lambda s, a, c: dict(user_input=s["question"], retrieved_contexts=c, reference=s["expected_answer"]))]


def run_ragas(run_id: int, limit: int | None = None) -> None:
    db = SessionLocal()
    try:
        run = db.get(TestRun, run_id)
        ok, why = real_llm_available()
        if not ok:
            finish_run(db, run, "skipped", f"Ragas needs a real LLM judge. {why} No scores were generated.")
            return
        run.status = "running"; db.commit()
        try:
            metrics = build_metrics()
        except Exception as e:                              # noqa: BLE001
            log.exception("Ragas setup failed")
            finish_run(db, run, "failed", f"Could not initialise Ragas: {type(e).__name__}: {e}")
            return
        scenarios = ec.load_scenarios(db, limit)
        run.total = len(scenarios) * len(metrics); db.commit()
        thr = settings.eval_threshold
        consecutive, abort = 0, None
        for sc in scenarios:
            try:
                actual, ctx = ec.run_chatbot(db, sc)
            except LLMError as e:
                run.errors += len(metrics)
                ec.save(db, run, "ragas", sc, "chatbot", None, None, False, None, None, [], f"{e.code}: {e.message}")
                consecutive += 1
                abort = e.message if (ec.is_fatal(e) or consecutive >= ec.MAX_CONSECUTIVE_ERRORS) else None
                if abort: break
                continue
            for name, metric, kwargs in metrics:
                try:
                    res = metric.score(**kwargs(sc, actual, ctx))
                    val = float(res.value)
                    passed = val >= thr
                    ec.save(db, run, "ragas", sc, name, val, thr, passed, getattr(res, "reason", None), actual, ctx)
                    run.passed += passed; run.failed += (not passed); consecutive = 0
                except Exception as e:                      # noqa: BLE001
                    log.exception("Ragas metric %s failed on %s", name, sc["key"])
                    run.errors += 1; consecutive += 1
                    ec.save(db, run, "ragas", sc, name, None, thr, False, None, actual, ctx, f"{type(e).__name__}: {e}")
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
