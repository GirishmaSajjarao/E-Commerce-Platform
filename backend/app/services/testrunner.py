"""Runs pytest suites in a subprocess from the dashboard; results are recorded by the conftest plugin."""
import logging, os, subprocess, sys
from app.config import ROOT
from app.database import SessionLocal
from app.models import ExecutionRecord, TestRun
from app.services.runs import finish_run

log = logging.getLogger(__name__)
MARKER_EXPR = {"offline": "not live_llm and not ui"}


def run_pytest(run_id: int, suite: str) -> None:
    db = SessionLocal()
    try:
        run = db.get(TestRun, run_id)
        run.status = "running"; db.commit()
        report = ROOT / "reports" / f"pytest_{suite}_{run_id}.html"
        cmd = [sys.executable, "-m", "pytest", "-q", "--html", str(report), "--self-contained-html"]
        if suite != "all":
            cmd += ["-m", MARKER_EXPR.get(suite, suite)]
        env = {**os.environ, "RECORD_RUN_ID": str(run_id), "RECORD_RESULTS": "1"}
        try:
            proc = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True, timeout=1500)
        except subprocess.TimeoutExpired:
            finish_run(db, run, "failed", "pytest exceeded the 25 minute limit and was stopped.")
            return
        recs = db.query(ExecutionRecord).filter(ExecutionRecord.run_id == run_id).all()
        run.total = len(recs)
        run.passed = sum(r.status == "passed" for r in recs)
        run.failed = sum(r.status in ("failed", "error") for r in recs)
        tail = "\n".join((proc.stdout or "").strip().splitlines()[-6:])
        if proc.returncode in (0, 1):
            finish_run(db, run, "completed", tail)
        else:
            finish_run(db, run, "failed", f"pytest exited with code {proc.returncode}.\n{tail}\n{(proc.stderr or '')[-800:]}")
    finally:
        db.close()
