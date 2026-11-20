"""Helpers for the TestRun lifecycle and background execution."""
import logging, threading
from app.database import SessionLocal, utcnow
from app.models import TestRun

log = logging.getLogger(__name__)
FATAL_LLM_CODES = {"missing_key", "invalid_key", "bad_model", "bad_provider", "quota"}


def create_run(db, kind: str, params: dict | None = None, is_mock: bool = False) -> TestRun:
    run = TestRun(kind=kind, params=params or {}, status="queued", is_mock=is_mock)
    db.add(run)
    db.commit()
    return run


def finish_run(db, run: TestRun, status: str, message: str | None = None) -> None:
    run.status, run.message, run.finished_at = status, message, utcnow()
    db.commit()


def spawn(target, *args) -> None:
    """Run target(*args) in a daemon thread; unexpected exceptions are logged and stored on the run (arg 0 = run_id)."""
    def wrapper():
        try:
            target(*args)
        except Exception as exc:                      # noqa: BLE001 - last-resort handler
            log.exception("Background run crashed")
            db = SessionLocal()
            try:
                run = db.get(TestRun, args[0])
                if run:
                    finish_run(db, run, "failed", f"Unexpected error: {type(exc).__name__}: {exc}")
            finally:
                db.close()
    threading.Thread(target=wrapper, daemon=True).start()
