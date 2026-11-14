#!/usr/bin/env bash
# Prepare a git worktree for development: its own .env, its own local database, deps.
# Usage (run from inside the worktree):  scripts/setup_worktree.sh <short-name> [gemini-budget-usd]
# The Gemini key is copied from the main checkout's .env. The database is a separate
# database inside the local TimescaleDB container, so branches never share rows.
set -euo pipefail
NAME="${1:?usage: scripts/setup_worktree.sh <short-name> [gemini-budget-usd]}"
BUDGET="${2:-1.5}"
HERE="$(git rev-parse --show-toplevel)"
MAIN="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
DBNAME="fs_$(echo "$NAME" | tr -c 'a-zA-Z0-9\n' '_' | tr 'A-Z' 'a-z')"

if [ "$HERE" = "$MAIN" ]; then
  echo "Refusing to run in the main checkout ($MAIN). Run this from inside a worktree." >&2
  exit 1
fi

KEY="$(grep -E '^GEMINI_API_KEY=' "$MAIN/.env" | head -1 | cut -d= -f2-)"
if [ -z "$KEY" ]; then echo "GEMINI_API_KEY is empty in $MAIN/.env" >&2; exit 1; fi

docker start firstshift-tsdb >/dev/null 2>&1 || true
docker exec firstshift-tsdb psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DBNAME'" | grep -q 1 \
  || docker exec firstshift-tsdb psql -U postgres -d postgres -c "CREATE DATABASE $DBNAME" >/dev/null

cat > "$HERE/.env" <<ENV
GEMINI_API_KEY=$KEY
DATABASE_URL=postgresql://postgres:firstshift@127.0.0.1:5433/$DBNAME
GEMINI_BUDGET_USD=$BUDGET
ENV

cd "$HERE"
uv sync --quiet
(cd backend && uv run python -m scripts.migrate)
echo "Worktree ready: $HERE  database=$DBNAME  gemini budget=\$$BUDGET"
