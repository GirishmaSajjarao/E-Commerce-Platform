"""Runs Promptfoo (npx) against the running backend and imports its JSON results."""
import json, logging, os, shutil, subprocess, sys, tempfile
from pathlib import Path
from app.config import ROOT, settings
from app.database import SessionLocal
from app.models import EvalResult, TestRun
from app.services.llm import real_llm_available
from app.services.runs import finish_run

log = logging.getLogger(__name__)
PROMPTFOO_VERSION = "0.125.1"
CONFIGS = {"deterministic": "promptfooconfig.yaml", "rubric": "promptfooconfig.rubric.yaml"}


def run_promptfoo(run_id: int, suite: str, base_url: str) -> None:
    db = SessionLocal()
    try:
        run = db.get(TestRun, run_id)
        if suite == "rubric":
            ok, why = real_llm_available()
            if not ok:
                finish_run(db, run, "skipped", f"The rubric suite uses an LLM grader. {why} Run the deterministic suite instead.")
                return
        if not shutil.which("npx"):
            finish_run(db, run, "failed", "Node.js/npx was not found. Install Node.js 18+ from https://nodejs.org and retry.")
            return
        run.status = "running"; db.commit()
        out = Path(tempfile.mkdtemp()) / "promptfoo_result.json"
        cfg = ROOT / "evaluation" / "promptfoo" / CONFIGS[suite]
        env = {**os.environ, "PROMPTFOO_DISABLE_TELEMETRY": "1", "PROMPTFOO_DISABLE_UPDATE": "1", "PROMPTFOO_PYTHON": sys.executable,
               "BACKEND_URL": base_url, "GOOGLE_API_KEY": settings.gemini_api_key, "GEMINI_API_KEY": settings.gemini_api_key,
               "PROMPTFOO_CONFIG_DIR": str(ROOT / "evaluation" / "promptfoo" / ".promptfoo")}
        cmd = [shutil.which("npx"), "--yes", f"promptfoo@{PROMPTFOO_VERSION}", "eval", "-c", str(cfg), "-o", str(out), "--no-cache", "--no-progress-bar"]
        try:
            proc = subprocess.run(cmd, cwd=cfg.parent, env=env, capture_output=True, text=True, timeout=900)
        except subprocess.TimeoutExpired:
            finish_run(db, run, "failed", "Promptfoo exceeded the 15 minute limit.")
            return
        if not out.exists():
            finish_run(db, run, "failed", f"Promptfoo produced no result file (exit code {proc.returncode}). {(proc.stderr or proc.stdout)[-600:]}")
            return
        data = json.loads(out.read_text(encoding="utf-8"))
        rows = (data.get("results") or {}).get("results") if isinstance(data.get("results"), dict) else data.get("results")
        mock = False
        for r in rows or []:
            vars_ = r.get("vars") or {}
            grading = r.get("gradingResult") or {}
            output = (r.get("response") or {}).get("output") if isinstance(r.get("response"), dict) else None
            mock = mock or "[MOCK RESPONSE]" in str(output)
            err = r.get("error")
            desc = (r.get("testCase") or {}).get("description") or r.get("description") or "test"
            ok = bool(r.get("success"))
            db.add(EvalResult(run_id=run_id, framework="promptfoo", scenario_key=str(desc)[:60], metric=f"assertions ({suite})",
                              score=r.get("score"), threshold=1.0, passed=ok, reason=(grading.get("reason") or "")[:1500] or None,
                              question=vars_.get("question"), actual_output=output if isinstance(output, str) else json.dumps(output),
                              error=str(err)[:1500] if err else None, is_mock=("[MOCK RESPONSE]" in str(output))))
            run.total += 1; run.passed += ok; run.failed += (not ok)
        run.is_mock = mock
        db.commit()
        finish_run(db, run, "completed", "Mock responses used: results do not reflect a real LLM." if mock else None)
    finally:
        db.close()
