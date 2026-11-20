"""Writes pytest results and API call timings into the results database (used by the root conftest.py plugin)."""
import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from app.config import ROOT
from app.database import Base
import app.models  # noqa: F401
from app.models import ApiCall, ExecutionRecord

RESULTS_URL = os.environ.get("RESULTS_DATABASE_URL") or f"sqlite:///{(ROOT / 'database' / 'qa_platform.db').as_posix()}"
_engine = _Session = None


def _session():
    global _engine, _Session
    if _engine is None:
        _engine = create_engine(RESULTS_URL, connect_args={"check_same_thread": False, "timeout": 15})

        @event.listens_for(_engine, "connect")
        def _p(c, _):
            cur = c.cursor(); cur.execute("PRAGMA journal_mode=WAL"); cur.execute("PRAGMA busy_timeout=5000"); cur.close()
        Base.metadata.create_all(_engine)
        _Session = sessionmaker(bind=_engine, expire_on_commit=False)
    return _Session()


def record_test(category, name, status, duration_ms, error=None, details=None, run_id=None):
    s = _session()
    try:
        s.add(ExecutionRecord(run_id=run_id, category=category, name=name[:300], status=status,
                              duration_ms=round(duration_ms, 1), error=(error or None) and error[:4000], details=details))
        s.commit()
    finally:
        s.close()


def record_api_call(method, path, status_code, latency_ms, test_name=None, run_id=None):
    s = _session()
    try:
        s.add(ApiCall(run_id=run_id, test_name=(test_name or "")[:300], method=method, path=path[:200],
                      status_code=status_code, latency_ms=round(latency_ms, 1)))
        s.commit()
    finally:
        s.close()
