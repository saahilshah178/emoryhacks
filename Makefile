.PHONY: run dev web db migrate test skills seed sample logins e2e repose fake-demo cost

# Start everything: the API and the web app. Open the address the web app prints
# (http://localhost:3000, or the next free port). The API takes any free local port and is
# only used by the web app. Another web port: PORT=3100 make run.
run:
	npm install --prefix frontend --no-audit --no-fund
	cd backend && uv run python -m scripts.run_app

# The two halves on their own, in two terminals, instead of `make run`.
# The API only, on port 8000. It serves /api and no pages.
dev:
	cd backend && uv run uvicorn app.main:app --port 8000

# The web app only. It forwards /api to the API from `make dev`.
# Another port: PORT=3100 make web. Another API: API_URL=http://127.0.0.1:8001 make web.
web:
	npm install --prefix frontend --no-audit --no-fund
	npm run dev --prefix frontend

# Local TimescaleDB for development (used when DATABASE_URL is not set to Tiger Cloud)
db:
	docker start firstshift-tsdb 2>/dev/null || docker run -d --name firstshift-tsdb \
	  -e POSTGRES_PASSWORD=firstshift -e POSTGRES_DB=tsdb -p 127.0.0.1:5433:5432 timescale/timescaledb-ha:pg17

migrate:
	cd backend && uv run python -m scripts.migrate

test:
	uv run pytest -q

# Add any of the nine standard skills this database does not have yet (no Gemini calls; the
# API does the same when it starts). `make skills ARGS=check` checks the file they come from,
# `make skills ARGS=export` rewrites it from this database.
skills:
	cd backend && uv run python -m scripts.builtin_skills $(ARGS)

# Build the nine rubrics again from the primary reference videos (real Gemini calls). Only
# needed to replace the standard ones; `make skills ARGS=export` then saves the result.
seed:
	cd backend && uv run python -m scripts.seed_reference

# Load (or reset) the sample agency, Harbor Home Care: a full roster, skills, attempts and
# reviews to look around in. No Gemini calls. Its people can log in once `make logins` has run.
sample:
	cd backend && uv run python -m scripts.seed_sample

# Give every login a new random password and write the usernames and passwords to LOGINS.md
# (gitignored). These are the only accounts that can sign in; see backend/scripts/logins.py.
logins:
	cd backend && uv run python -m scripts.logins

# Run stand-in caregiver attempts against the seeded skills (real Gemini calls).
# Narrow it with: make e2e ARGS="--skills sit_to_stand --cases self,missing"
e2e:
	cd backend && uv run python -m scripts.e2e $(ARGS)

# Measure pose again for every skill's reference video (after changing how pose is measured)
repose:
	cd backend && uv run python -m scripts.repose $(ARGS)

# Create one fake skill and one fake attempt without calling Gemini
fake-demo:
	cd backend && FIRSTSHIFT_FAKE_AI=1 uv run python -m scripts.fake_demo

# Recorded Gemini spend for the current database
cost:
	cd backend && uv run python -m scripts.cost
