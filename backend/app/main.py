"""The API. It serves JSON and video under /api and nothing else: the only UI is the web app
in frontend/, which forwards /api to this server.

`make run` starts both. On its own, from the backend directory:
    uv run uvicorn app.main:app --port 8000
(Do not use --reload while a pipeline is running: a restart interrupts the job.)
"""
from __future__ import annotations

import re
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import builtin, config, db, gemini, repo
from . import jobs as pipeline
from .routers import accounts, attempts, jobs, people, review, safety, skills, videos


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    db.migrate()
    builtin.ensure()  # the nine standard skills, on any database, without a Gemini call
    pipeline.resume_interrupted()  # grading cut short by the last shutdown carries on where it stopped
    yield
    db.close()


app = FastAPI(title="FirstShift", lifespan=lifespan)

def allowed_origin_regex(origins: list[str]) -> str:
    """A pattern for the origins whose pages may call this API: any local address, plus the web
    app's own origins from config.WEB_ORIGINS, where "*" stands for one host-name label."""
    patterns = [r"https?://(localhost|127\.0\.0\.1)(:\d+)?"]
    patterns += [re.escape(origin).replace(r"\*", "[A-Za-z0-9-]+") for origin in origins]
    return "|".join(f"(?:{pattern})" for pattern in patterns)


# The Next.js app proxies /api to this server, so the browser sees one origin and the session
# cookie just works. Two things call the API from another origin: local development, and video
# uploads from the hosted web app, which go straight here with an upload ticket (routers/videos.py).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=allowed_origin_regex(config.WEB_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

for module in (accounts, people, videos, skills, attempts, review, safety, jobs):
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
                   # spend of the key now configured, which is what the budget applies to
                   "spent_usd": round(gemini.spent_usd(), 4), "budget_usd": config.GEMINI_BUDGET_USD,
                   "key_id": gemini.key_id() if config.GEMINI_API_KEY else None,
                   "spent_all_keys_usd": round(gemini.spent_all_usd(), 4),
                   "job_budget_usd": config.GEMINI_JOB_BUDGET_USD,
                   "reference_budget_usd": config.GEMINI_REFERENCE_BUDGET_USD,
                   # set when the last video failed because of the AI account (credit, budget, key)
                   "problem": repo.ai_problem()},
    }


@app.get("/", include_in_schema=False)
def root():
    """For anyone who opens this address in a browser: there are no pages here."""
    return {"service": "API", "health": "/api/health",
            "web_app": "This server has no pages. Run `make run` and open the address the web app prints."}
