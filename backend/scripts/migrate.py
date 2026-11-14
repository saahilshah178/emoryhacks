"""Apply the schema to the configured database."""
from app import config, db

if __name__ == "__main__":
    db.migrate()
    row = db.fetch_one("SELECT extversion FROM pg_extension WHERE extname='timescaledb'")
    print(f"Schema applied. Database source: {config.DB_SOURCE}. TimescaleDB {row['extversion']}.")
