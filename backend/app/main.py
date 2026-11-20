import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from app.config import ROOT, settings
from app.database import Base, SessionLocal, engine
from app import models  # noqa: F401
from app.models import AppSetting
from app.routes import auth_catalog, chat, qa
from app.seed import seed_db
from app.utils.logging_setup import setup_logging

setup_logging()
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        seed_db(db)
        for s in db.query(AppSetting):
            if s.key in ("eval_threshold", "hallucination_threshold"):
                setattr(settings, s.key, float(s.value))
    finally:
        db.close()
    log.info("Started. MOCK_MODE=%s provider=%s", settings.mock_mode, settings.llm_provider)
    yield


app = FastAPI(title="E-Commerce AI Customer Support QA Platform", version="1.0.0", lifespan=lifespan,
              description="Chatbot + AI quality assurance platform. Login via POST /api/auth/login, then click Authorize.")


@app.exception_handler(Exception)
async def unhandled(_, exc: Exception):
    log.exception("Unhandled error")
    return JSONResponse(status_code=500, content={"detail": f"Internal server error: {type(exc).__name__}"})


@app.get("/api/health", tags=["System"])
def health():
    return {"status": "ok", "mock_mode": settings.mock_mode, "llm_provider": "mock" if settings.mock_mode else settings.llm_provider}


app.include_router(auth_catalog.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(qa.router, prefix="/api")

FRONTEND = ROOT / "frontend"
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
