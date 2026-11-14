.PHONY: dev db migrate test seed fake-demo cost

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

# Create one fake skill and one fake attempt without calling Gemini
fake-demo:
	cd backend && FIRSTSHIFT_FAKE_AI=1 uv run python -m scripts.fake_demo

# Recorded Gemini spend for the current database
cost:
	cd backend && uv run python -m scripts.cost
