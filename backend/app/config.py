"""Settings. Values come from .env, then .env.local, then the process environment."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = ROOT / "fixtures"
REFERENCE_DIR = ROOT / "reference_vids"

_PREFIXES = ("GEMINI_", "DATABASE_URL", "DEV_DATABASE_URL", "FIRSTSHIFT_", "POSE_")


def _load() -> dict[str, str]:
    vals: dict[str, str] = {}
    for name in (".env", ".env.local"):
        path = ROOT / name
        if path.exists():
            vals.update({k: v for k, v in dotenv_values(path).items() if v})
    vals.update({k: v for k, v in os.environ.items() if k.startswith(_PREFIXES) and v})
    return vals


_V = _load()


def _get(key: str, default: str = "") -> str:
    return _V.get(key, default)


def _is_pg(url: str) -> bool:
    return url.startswith(("postgres://", "postgresql://"))


# --- database -------------------------------------------------------------
# DATABASE_URL is the Tiger Data service. If it is missing or is not a postgres URL,
# fall back to the local TimescaleDB container so development is never blocked.
LOCAL_DEV_DATABASE_URL = "postgresql://postgres:firstshift@127.0.0.1:5433/tsdb"
_primary = _get("DATABASE_URL")
_dev = _get("DEV_DATABASE_URL", LOCAL_DEV_DATABASE_URL)
if _is_pg(_primary):
    DATABASE_URL = _primary
    DB_SOURCE = "DATABASE_URL"
else:
    DATABASE_URL = _dev
    DB_SOURCE = "DEV_DATABASE_URL (DATABASE_URL is empty or not a postgres:// URL)"
DB_IS_TIGER_CLOUD = "tsdb.cloud" in DATABASE_URL or "tigerdata" in DATABASE_URL

# --- gemini ---------------------------------------------------------------
GEMINI_API_KEY = _get("GEMINI_API_KEY")
GEMINI_MODEL_MAIN = _get("GEMINI_MODEL_MAIN", "gemini-4-hydrogen")
GEMINI_MODEL_STRONG = _get("GEMINI_MODEL_STRONG", "gemini-4-carbon")
GEMINI_MODEL_FALLBACK = _get("GEMINI_MODEL_FALLBACK", "gemini-3.8-flash")
# Hard stop for the recorded Gemini spend of the API key now in GEMINI_API_KEY, in US dollars.
# Calls are logged with a fingerprint of the key that made them, so a new key starts from zero.
# The Settings page shows how much is used. Raise it in .env (GEMINI_BUDGET_USD) to keep going.
GEMINI_BUDGET_USD = float(_get("GEMINI_BUDGET_USD", "10"))
# What one pipeline job may spend. Optional calls (second looks at unclear steps, pose-flag
# confirmation, boundary refinement, the summary rewrite) are skipped once the job's recorded
# spend plus the call's estimate would pass the allowance; the required calls always run.
# Nothing at all is sent once a job has spent 1.5 times its allowance (the hard ceiling), so
# retries and repairs on a difficult video cannot run up the bill.
GEMINI_JOB_BUDGET_USD = float(_get("GEMINI_JOB_BUDGET_USD", "0.15"))            # caregiver attempt
GEMINI_REFERENCE_BUDGET_USD = float(_get("GEMINI_REFERENCE_BUDGET_USD", "0.20"))  # nurse reference video
GEMINI_JOB_HARD_LIMIT_FACTOR = 1.5
GEMINI_CONCURRENCY = int(_get("GEMINI_CONCURRENCY", "3"))
# Per-call ceiling on thinking plus reply tokens. Stages set lower caps of their own.
GEMINI_MAX_OUTPUT_TOKENS = int(_get("GEMINI_MAX_OUTPUT_TOKENS", "10000"))
# A job interrupted by a server restart is resumed when the server starts again, at most this
# many times; after that it is marked as failed so a job that crashes the server cannot loop.
JOB_MAX_RESUMES = int(_get("FIRSTSHIFT_JOB_MAX_RESUMES", "3"))
# US dollars per million tokens: (input, output). Thinking tokens bill as output.
GEMINI_PRICES: dict[str, tuple[float, float]] = {
    "gemini-4-hydrogen": (1.5, 7.5),
    "gemini-4-carbon": (4.0, 20.0),
    "gemini-4-argon": (4.0, 20.0),
    "gemini-3.8-flash": (1.5, 7.5),
    "gemini-3.6-flash": (1.5, 7.5),
    "gemini-3.5-flash-lite": (0.3, 2.5),
}
GEMINI_DEFAULT_PRICE = (4.0, 20.0)
# Input tokens Gemini bills for media, used only to estimate a call's cost before sending it:
# video per frame at each resolution (measured: low and medium both about 85 a frame), the
# audio track per second, and one image at each resolution (measured: low 300, default 1,100).
VIDEO_TOKENS_PER_FRAME = {"low": 85, "medium": 85, "high": 300}
AUDIO_TOKENS_PER_SECOND = 25
IMAGE_TOKENS = {"low": 300, "medium": 600, "high": 1100}

# When set, every AI stage returns canned data and no Gemini call is made.
FAKE_AI = _get("FIRSTSHIFT_FAKE_AI", "0") == "1"

# --- storage --------------------------------------------------------------
DATA_DIR = Path(_get("FIRSTSHIFT_DATA_DIR", str(ROOT / "data")))
VIDEO_DIR = DATA_DIR / "videos"
THUMB_DIR = DATA_DIR / "thumbs"
MODEL_DIR = DATA_DIR / "models"
TMP_DIR = DATA_DIR / "tmp"
MAX_UPLOAD_MB = int(_get("FIRSTSHIFT_MAX_UPLOAD_MB", "300"))
# Where a browser can reach this API directly, e.g. https://api.example.com. Set it when the web
# app is hosted somewhere whose proxy caps request bodies (Vercel refuses forwarded uploads above
# about 20 MB): videos are then sent straight here, with a short-lived upload ticket, instead of
# through the web app's /api. Empty means uploads go through the web app, as on a laptop.
PUBLIC_API_URL = _get("FIRSTSHIFT_PUBLIC_API_URL").rstrip("/")
# The web app's origins, comma-separated, which may call this API from a browser (CORS). A "*"
# stands for one label of letters, digits and dashes: https://myapp-*.vercel.app
WEB_ORIGINS = [o.strip().rstrip("/") for o in _get("FIRSTSHIFT_WEB_ORIGINS").split(",") if o.strip()]
# The largest upload the web app's own proxy passes on, when PUBLIC_API_URL is not set. 0: no cap.
PROXY_MAX_UPLOAD_MB = float(_get("FIRSTSHIFT_PROXY_MAX_UPLOAD_MB", "0"))

# --- pose -----------------------------------------------------------------
# Pose is measured on every frame up to POSE_FPS, so a webcam attempt of up to about 100 s
# at 30 fps has every frame stored. Longer videos are sampled down to POSE_MAX_FRAMES frames.
POSE_FPS = float(_get("POSE_FPS", "30"))
POSE_MAX_FRAMES = int(_get("POSE_MAX_FRAMES", "3000"))
# Uploads shorter than this are rejected (a still image decodes as a one-frame video).
MIN_VIDEO_SECONDS = float(_get("FIRSTSHIFT_MIN_VIDEO_SECONDS", "2"))
POSE_ENABLED = _get("POSE_ENABLED", "1") == "1"


def ensure_dirs() -> None:
    for d in (VIDEO_DIR, THUMB_DIR, MODEL_DIR, TMP_DIR):
        d.mkdir(parents=True, exist_ok=True)
