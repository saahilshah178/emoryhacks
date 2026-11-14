"""FirstShift API and static frontend.

Run from the backend directory:  uv run uvicorn app.main:app --port 8000
(Do not use --reload while a pipeline is running: a restart interrupts the job.)
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import config, db, gemini, repo
from .routers import attempts, jobs, review, safety, skills, videos


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    db.migrate()
    repo.fail_interrupted_jobs()
    yield
    db.close()


app = FastAPI(title="FirstShift", lifespan=lifespan)

for module in (videos, skills, attempts, review, safety, jobs):
    app.include_router(module.router, prefix="/api")


@app.get("/api/health")
def health():
    row = db.fetch_one(
        "SELECT (SELECT extversion FROM pg_extension WHERE extname='timescaledb') AS timescaledb, "
        "(SELECT count(*) FROM skills) AS skills, (SELECT count(*) FROM attempts) AS attempts, "
        "(SELECT count(*) FROM pose_frames) AS pose_frames"
    )
    return {
        "ok": True,
        "database": {"source": config.DB_SOURCE, "tiger_cloud": config.DB_IS_TIGER_CLOUD, **row},
        "gemini": {"key_set": bool(config.GEMINI_API_KEY), "model_main": config.GEMINI_MODEL_MAIN,
                   "model_strong": config.GEMINI_MODEL_STRONG, "fake_ai": config.FAKE_AI,
                   "spent_usd": round(gemini.spent_usd(), 4), "budget_usd": config.GEMINI_BUDGET_USD},
    }


app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR), html=True), name="frontend")
