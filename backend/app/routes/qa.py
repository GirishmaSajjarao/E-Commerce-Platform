import logging
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.models import AppSetting, EvalResult, ExecutionRecord, SecurityResult, TestCase, TestRun, User
from app.schemas import EvalRunIn, ReportIn, SecurityRunIn, TestCaseIn, TestExecuteIn, ThresholdsIn
from app.security import admin_user
from app.services import dashboard, reports
from app.services.llm import LLMError, get_provider, real_llm_available
from app.services.runs import create_run, finish_run, spawn

router = APIRouter(dependencies=[Depends(admin_user)])
log = logging.getLogger(__name__)


def d(obj, skip=()):
    out = {}
    for c in obj.__table__.columns:
        if c.name in skip:
            continue
        v = getattr(obj, c.name)
        out[c.name] = v.isoformat() if hasattr(v, "isoformat") else v
    return out


# ---------- dashboard ----------
@router.get("/dashboard/summary", tags=["Dashboard"])
def dash_summary(date_from: str | None = None, date_to: str | None = None, category: str | None = None,
                 framework: str | None = None, status: str | None = Query(default=None, pattern="^(passed|failed|skipped)$"),
                 db: Session = Depends(get_db)):
    return dashboard.summary(db, date_from, date_to, category, framework, status)


@router.get("/dashboard/trends", tags=["Dashboard"])
def dash_trends(date_from: str | None = None, date_to: str | None = None, db: Session = Depends(get_db)):
    return dashboard.trends(db, date_from, date_to)


# ---------- test cases ----------
@router.get("/test-cases", tags=["Test Cases"])
def list_cases(suite: str | None = None, db: Session = Depends(get_db)):
    q = db.query(TestCase)
    if suite:
        q = q.filter(TestCase.suite == suite)
    return [d(c) for c in q.order_by(TestCase.suite, TestCase.key)]


@router.post("/test-cases", status_code=201, tags=["Test Cases"])
def add_case(body: TestCaseIn, db: Session = Depends(get_db)):
    if db.query(TestCase).filter_by(suite=body.suite, key=body.key).first():
        raise HTTPException(409, f"A {body.suite} test case with key {body.key} already exists.")
    need = ["question", "expected_answer"] if body.suite == "evaluation" else ["prompt", "expect"]
    missing = [k for k in need if k not in body.payload]
    if missing:
        raise HTTPException(422, f"payload is missing required field(s): {', '.join(missing)}")
    c = TestCase(suite=body.suite, key=body.key, category=body.category, name=body.name, payload={**body.payload, "key": body.key, "category": body.category, "name": body.name})
    db.add(c); db.commit()
    return d(c)


@router.patch("/test-cases/{case_id}/toggle", tags=["Test Cases"])
def toggle_case(case_id: int, db: Session = Depends(get_db)):
    c = db.get(TestCase, case_id)
    if not c:
        raise HTTPException(404, "Test case not found.")
    c.enabled = not c.enabled; db.commit()
    return d(c)


@router.delete("/test-cases/{case_id}", status_code=204, tags=["Test Cases"])
def delete_case(case_id: int, db: Session = Depends(get_db)):
    c = db.get(TestCase, case_id)
    if not c:
        raise HTTPException(404, "Test case not found.")
    db.delete(c); db.commit()


# ---------- runs / history ----------
@router.get("/runs", tags=["Test Execution"])
def list_runs(kind: str | None = None, status: str | None = None, limit: int = Query(50, le=200), db: Session = Depends(get_db)):
    q = db.query(TestRun)
    if kind:
        q = q.filter(TestRun.kind == kind)
    if status:
        q = q.filter(TestRun.status == status)
    return [d(r) for r in q.order_by(TestRun.id.desc()).limit(limit)]


@router.get("/runs/{run_id}", tags=["Test Execution"])
def get_run(run_id: int, db: Session = Depends(get_db)):
    r = db.get(TestRun, run_id)
    if not r:
        raise HTTPException(404, "Run not found.")
    return d(r)


def _start(db: Session, kind: str, params: dict, request: Request) -> TestRun:
    """Creates and launches a run. Used by the endpoints and by rerun."""
    if kind in ("deepeval", "ragas", "promptfoo"):
        from app.services import eval_deepeval, eval_promptfoo, eval_ragas
        mock = settings.mock_mode
        run = create_run(db, kind, params, is_mock=False)
        if kind == "promptfoo":
            run.is_mock = mock; db.commit()
            spawn(eval_promptfoo.run_promptfoo, run.id, params.get("promptfoo_suite", "deterministic"), str(request.base_url).rstrip("/"))
        elif kind == "deepeval":
            spawn(eval_deepeval.run_deepeval, run.id, params.get("limit"))
        else:
            spawn(eval_ragas.run_ragas, run.id, params.get("limit"))
        return run
    if kind == "security":
        from app.services import security_tests
        run = create_run(db, kind, params, is_mock=settings.mock_mode)
        spawn(security_tests.run_security, run.id, params.get("case_keys"))
        return run
    if kind == "pytest":
        from app.services import testrunner
        if db.query(TestRun).filter(TestRun.kind == "pytest", TestRun.status.in_(["queued", "running"])).first():
            raise HTTPException(409, "A pytest run is already in progress. Wait for it to finish.")
        run = create_run(db, kind, params)
        spawn(testrunner.run_pytest, run.id, params["suite"])
        return run
    raise HTTPException(400, f"Cannot start runs of kind {kind}.")


@router.post("/runs/{run_id}/rerun", status_code=202, tags=["Test Execution"])
def rerun(run_id: int, request: Request, db: Session = Depends(get_db)):
    old = db.get(TestRun, run_id)
    if not old:
        raise HTTPException(404, "Run not found.")
    return d(_start(db, old.kind, old.params or {}, request))


# ---------- evaluations ----------
@router.post("/evaluations/run", status_code=202, tags=["LLM Evaluation"])
def run_evaluation(body: EvalRunIn, request: Request, db: Session = Depends(get_db)):
    return d(_start(db, body.framework, body.model_dump(), request))


@router.get("/evaluations/results", tags=["LLM Evaluation"])
def eval_results(run_id: int | None = None, framework: str | None = None, limit: int = Query(300, le=2000), db: Session = Depends(get_db)):
    q = db.query(EvalResult)
    if run_id:
        q = q.filter(EvalResult.run_id == run_id)
    if framework:
        q = q.filter(EvalResult.framework == framework)
    return [d(r) for r in q.order_by(EvalResult.id.desc()).limit(limit)]


@router.get("/evaluations/compare", tags=["LLM Evaluation"])
def compare(db: Session = Depends(get_db)):
    """Average score per metric for DeepEval vs Ragas (latest 2000 non-error rows). Frameworks are stored separately."""
    out: dict = {}
    for r in db.query(EvalResult).filter(EvalResult.error.is_(None), EvalResult.score.isnot(None), EvalResult.framework.in_(["deepeval", "ragas"])).order_by(EvalResult.id.desc()).limit(2000):
        key = r.metric.lower().replace(" ", "_")
        out.setdefault(key, {}).setdefault(r.framework, []).append(r.score)
    return {m: {fw: round(sum(v) / len(v), 3) for fw, v in fws.items()} for m, fws in out.items()}


# ---------- security ----------
@router.post("/security/run", status_code=202, tags=["AI Security"])
def run_security(body: SecurityRunIn, request: Request, db: Session = Depends(get_db)):
    return d(_start(db, "security", body.model_dump(), request))


@router.get("/security/results", tags=["AI Security"])
def security_results(run_id: int | None = None, limit: int = Query(300, le=2000), db: Session = Depends(get_db)):
    q = db.query(SecurityResult)
    if run_id:
        q = q.filter(SecurityResult.run_id == run_id)
    return [d(r) for r in q.order_by(SecurityResult.id.desc()).limit(limit)]


# ---------- software tests ----------
@router.post("/tests/execute", status_code=202, tags=["Test Execution"])
def execute_tests(body: TestExecuteIn, request: Request, db: Session = Depends(get_db)):
    return d(_start(db, "pytest", {"suite": body.suite}, request))


@router.get("/tests/records", tags=["Test Execution"])
def records(category: str | None = None, status: str | None = None, run_id: int | None = None, limit: int = Query(200, le=1000), db: Session = Depends(get_db)):
    q = db.query(ExecutionRecord)
    if category:
        q = q.filter(ExecutionRecord.category == category)
    if status:
        q = q.filter(ExecutionRecord.status == status)
    if run_id:
        q = q.filter(ExecutionRecord.run_id == run_id)
    return [d(r) for r in q.order_by(ExecutionRecord.id.desc()).limit(limit)]


# ---------- reports ----------
@router.post("/reports/generate", tags=["Reports"])
def gen_report(body: ReportIn, db: Session = Depends(get_db)):
    try:
        return reports.generate(db, body.format)
    except OSError as e:
        raise HTTPException(500, f"Could not write the report file: {e}")


@router.get("/reports", tags=["Reports"])
def list_reports():
    files = sorted((p for p in reports.reports_dir().glob("*") if p.suffix in (".html", ".json")), key=lambda p: p.stat().st_mtime, reverse=True)
    return [{"name": p.name, "size_kb": round(p.stat().st_size / 1024, 1)} for p in files[:50]]


@router.get("/reports/{name}", tags=["Reports"])
def get_report(name: str):
    p = (reports.reports_dir() / Path(name).name)
    if not p.is_file() or p.suffix not in (".html", ".json"):
        raise HTTPException(404, "Report not found.")
    return FileResponse(p)


# ---------- settings ----------
def _settings_view() -> dict:
    return {"mock_mode": settings.mock_mode, "llm_provider": settings.llm_provider, "model": settings.gemini_model,
            "api_key_configured": bool(settings.gemini_api_key), "eval_threshold": settings.eval_threshold,
            "hallucination_threshold": settings.hallucination_threshold, "database": "SQLite (database/qa_platform.db)",
            "real_llm_available": real_llm_available()[0], "real_llm_hint": real_llm_available()[1]}


@router.get("/settings", tags=["Settings"])
def get_settings():
    return _settings_view()


@router.put("/settings/thresholds", tags=["Settings"])
def put_thresholds(body: ThresholdsIn, db: Session = Depends(get_db)):
    for k in ("eval_threshold", "hallucination_threshold"):
        v = getattr(body, k)
        setattr(settings, k, v)
        row = db.get(AppSetting, k)
        if row: row.value = str(v)
        else: db.add(AppSetting(key=k, value=str(v)))
    db.commit()
    return _settings_view()


@router.post("/settings/test-connection", tags=["Settings"])
def test_connection(real: bool = True):
    """real=true checks the real provider even while MOCK_MODE is on, so you can validate your key first."""
    try:
        return get_provider(force_real=real).test_connection()
    except LLMError as e:
        return {"ok": False, "code": e.code, "message": e.message}


@router.get("/tests/api-calls", tags=["Test Execution"])
def api_calls(limit: int = Query(100, le=1000), db: Session = Depends(get_db)):
    from app.models import ApiCall
    return [d(r) for r in db.query(ApiCall).order_by(ApiCall.id.desc()).limit(limit)]
