.PHONY: dev db migrate test seed e2e repose fake-demo cost

# Start the app at http://localhost:8000
dev:
	cd backend && uv run uvicorn app.main:app --port 8000

# Local TimescaleDB for development (used when DATABASE_URL is not set to Tiger Cloud)
db:
	docker start firstshift-tsdb 2>/dev/null || docker run -d --name firstshift-tsdb \
	  -e POSTGRES_PASSWORD=firstshift -e POSTGRES_DB=tsdb -p 127.0.0.1:5433:5432 timescale/timescaledb-ha:pg17

migrate:
	cd backend && uv run python -m scripts.migrate

test:
	uv run pytest -q

# Run the primary reference videos through the nurse pipeline (real Gemini calls)
seed:
	cd backend && uv run python -m scripts.seed_reference

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
