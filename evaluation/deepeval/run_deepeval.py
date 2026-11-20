"""CLI: python evaluation/deepeval/run_deepeval.py [--limit 5]   (needs MOCK_MODE=false and GEMINI_API_KEY in .env)"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from app.database import Base, SessionLocal, engine  # noqa: E402
import app.models  # noqa: E402
from app.seed import seed_db  # noqa: E402
from app.services.runs import create_run  # noqa: E402
from app.services.eval_deepeval import run_deepeval  # noqa: E402

ap = argparse.ArgumentParser(); ap.add_argument("--limit", type=int, default=None)
a = ap.parse_args()
Base.metadata.create_all(engine)
db = SessionLocal(); seed_db(db)
run = create_run(db, "deepeval", {"limit": a.limit}); rid = run.id; db.close()
run_deepeval(rid, a.limit)
db = SessionLocal(); from app.models import TestRun; r = db.get(TestRun, rid)
print(f"Run {rid}: {r.status} | passed={r.passed} failed={r.failed} errors={r.errors}\n{r.message or ''}")
