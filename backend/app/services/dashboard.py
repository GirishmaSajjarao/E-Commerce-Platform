"""Dashboard metrics computed ONLY from stored records. Software test pass rates and LLM evaluation scores are kept separate."""
from collections import defaultdict
from datetime import datetime, timedelta
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models import ApiCall, EvalResult, ExecutionRecord, Message, SecurityResult, TestCase, TestRun

SOFTWARE_CATEGORIES = ["unit", "integration", "api", "functional", "regression", "llm_eval", "security", "ui"]


def _pct(a, b):
    return round(100 * a / b, 1) if b else None


def _range(q, col, d_from, d_to):
    if d_from:
        q = q.filter(col >= datetime.fromisoformat(d_from))
    if d_to:
        q = q.filter(col < datetime.fromisoformat(d_to) + timedelta(days=1))
    return q


def metric_value(r: EvalResult):
    """Normalised 'higher is better' value: hallucination is inverted."""
    if r.score is None:
        return None
    return 1 - r.score if r.metric.lower().startswith("hallucination") else r.score


def summary(db: Session, date_from=None, date_to=None, category=None, framework=None, status=None) -> dict:
    sw = _range(db.query(ExecutionRecord), ExecutionRecord.created_at, date_from, date_to)
    if category in SOFTWARE_CATEGORIES:
        sw = sw.filter(ExecutionRecord.category == category)
    if status:
        sw = sw.filter(ExecutionRecord.status == status)
    sw_rows = sw.all()
    by_cat = defaultdict(lambda: {"passed": 0, "failed": 0, "skipped": 0})
    for r in sw_rows:
        by_cat[r.category]["passed" if r.status == "passed" else "skipped" if r.status == "skipped" else "failed"] += 1
    sw_pass = sum(1 for r in sw_rows if r.status == "passed")
    sw_skip = sum(1 for r in sw_rows if r.status == "skipped")
    sw_fail = len(sw_rows) - sw_pass - sw_skip

    sec_q = _range(db.query(SecurityResult), SecurityResult.created_at, date_from, date_to)
    if status in ("passed", "failed"):
        sec_q = sec_q.filter(SecurityResult.passed.is_(status == "passed"))
    sec = sec_q.all()
    sec_cat = defaultdict(lambda: {"passed": 0, "failed": 0})
    for r in sec:
        sec_cat[r.category]["passed" if r.passed else "failed"] += 1

    ev_q = _range(db.query(EvalResult), EvalResult.created_at, date_from, date_to)
    if framework:
        ev_q = ev_q.filter(EvalResult.framework == framework)
    if status in ("passed", "failed"):
        ev_q = ev_q.filter(EvalResult.passed.is_(status == "passed"))
    ev = ev_q.all()
    frameworks: dict = {}
    for fw in sorted({r.framework for r in ev}):
        rows = [r for r in ev if r.framework == fw]
        scored = [r for r in rows if r.score is not None and r.error is None]
        mets = defaultdict(list)
        for r in scored:
            mets[r.metric].append(r.score)
        vals = [metric_value(r) for r in scored]
        frameworks[fw] = {
            "results": len(rows), "errors": sum(1 for r in rows if r.error), "mock_rows": sum(1 for r in rows if r.is_mock),
            "metric_pass_rate": _pct(sum(1 for r in rows if r.passed), len(rows)),
            "average_score": round(sum(vals) / len(vals), 3) if vals else None,
            "metrics": {m: round(sum(v) / len(v), 3) for m, v in mets.items()}}
    de = [r for r in ev if r.framework == "deepeval" and r.metric.lower().startswith("hallucination") and r.error is None]
    genuine = [metric_value(r) for r in ev if r.framework in ("deepeval", "ragas") and not r.is_mock and r.score is not None and r.error is None]

    api_rows = _range(db.query(ApiCall), ApiCall.created_at, date_from, date_to).all()
    lat = sorted(a.latency_ms for a in api_rows)
    api_tests = [r for r in sw_rows if r.category == "api"]
    chat_lat = db.query(Message.is_mock, func.avg(Message.latency_ms), func.count()).filter(
        Message.role == "assistant", Message.latency_ms.isnot(None)).group_by(Message.is_mock).all()

    recent = _range(db.query(ExecutionRecord), ExecutionRecord.created_at, date_from, date_to).order_by(ExecutionRecord.id.desc()).limit(10).all()
    return {
        "software_tests": {"total": len(sw_rows), "passed": sw_pass, "failed": sw_fail, "skipped": sw_skip,
                           "pass_percentage": _pct(sw_pass, len(sw_rows) - sw_skip), "by_category": by_cat,
                           "distinct_tests": len({r.name for r in sw_rows})},
        "test_cases_in_datasets": {"evaluation": db.query(TestCase).filter(TestCase.suite == "evaluation").count(),
                                   "security": db.query(TestCase).filter(TestCase.suite == "security").count()},
        "security": {"total": len(sec), "passed": sum(1 for r in sec if r.passed), "failed": sum(1 for r in sec if not r.passed),
                     "pass_percentage": _pct(sum(1 for r in sec if r.passed), len(sec)), "mock_results": sum(1 for r in sec if r.is_mock),
                     "by_category": sec_cat},
        "llm_evaluation": {"frameworks": frameworks,
                           "overall_score_genuine": round(sum(genuine) / len(genuine), 3) if genuine else None,
                           "hallucination_checks": len(de), "hallucinations_detected": sum(1 for r in de if not r.passed),
                           "note": "Model quality scores (0-1) from DeepEval/Ragas. Hallucination is inverted (1 - score). Not a pass rate."},
        "api": {"calls": len(api_rows), "avg_latency_ms": round(sum(lat) / len(lat), 1) if lat else None,
                "p95_latency_ms": lat[int(0.95 * (len(lat) - 1))] if lat else None,
                "success_rate": _pct(sum(1 for r in api_tests if r.status == "passed"), len(api_tests)),
                "chat_latency": [{"mock": bool(m), "avg_ms": round(a, 1), "n": n} for m, a, n in chat_lat]},
        "recent_executions": [{"id": r.id, "category": r.category, "name": r.name, "status": r.status,
                               "duration_ms": r.duration_ms, "created_at": r.created_at.isoformat()} for r in recent],
        "has_mock_data": any(r.is_mock for r in sec) or any(r.is_mock for r in ev),
    }


def trends(db: Session, date_from=None, date_to=None) -> dict:
    sw, sec, ev = defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0]), defaultdict(lambda: defaultdict(list))
    for r in _range(db.query(ExecutionRecord), ExecutionRecord.created_at, date_from, date_to):
        if r.status != "skipped":
            d = r.created_at.date().isoformat(); sw[d][1] += 1; sw[d][0] += r.status == "passed"
    for r in _range(db.query(SecurityResult), SecurityResult.created_at, date_from, date_to):
        d = r.created_at.date().isoformat(); sec[d][1] += 1; sec[d][0] += bool(r.passed)
    for r in _range(db.query(EvalResult), EvalResult.created_at, date_from, date_to):
        v = metric_value(r)
        if v is not None and r.error is None and not r.is_mock and r.framework in ("deepeval", "ragas"):
            ev[r.framework][r.created_at.date().isoformat()].append(v)
    days = sorted(set(sw) | set(sec) | {d for f in ev.values() for d in f})
    return {"labels": days,
            "software_pass_pct": [_pct(*sw[d]) if d in sw else None for d in days],
            "security_pass_pct": [_pct(*sec[d]) if d in sec else None for d in days],
            "eval_score": {fw: [round(sum(ev[fw][d]) / len(ev[fw][d]), 3) if d in ev[fw] else None for d in days] for fw in ev}}
