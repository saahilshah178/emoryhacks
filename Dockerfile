# The API (backend/) as a container, for hosting it away from a laptop. See fly.toml.
#
# The web app in frontend/ is deployed on its own (Vercel) and forwards /api to wherever
# this runs: set API_URL there to this server's address.
#
# The image keeps the repository's layout under /app, because backend/app/config.py finds
# reference_vids/ relative to itself. Uploaded videos, thumbnails and the pose model are
# written to /data, which should be a disk that outlives the container.
FROM python:3.12-slim-bookworm

# System libraries the Python packages load at run time: libGL and GLib for OpenCV (which
# MediaPipe imports), EGL and GLES for MediaPipe's own library. Without the last two the
# server starts but every pose measurement fails.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libegl1 libgles2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    FIRSTSHIFT_DATA_DIR=/data

# Packages first, so that changing the code does not reinstall them.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-cache

COPY backend ./backend
# A reference video whose file is not on this machine is rebuilt from here.
COPY reference_vids ./reference_vids

WORKDIR /app/backend
EXPOSE 8000
# One process: grading jobs run in this process's own threads (backend/app/jobs.py).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
