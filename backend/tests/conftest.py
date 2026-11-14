"""Tests run against a throwaway database in the local TimescaleDB container, with
canned AI output (no Gemini calls). They are skipped if the container is not running."""
import hashlib
import os
import tempfile
from pathlib import Path

import psycopg
import pytest

ADMIN_URL = "postgresql://postgres:firstshift@127.0.0.1:5433/postgres"
_root = Path(__file__).resolve().parents[2]
TEST_DB = "fs_test_" + hashlib.sha1(str(_root).encode()).hexdigest()[:8]
os.environ["DATABASE_URL"] = f"postgresql://postgres:firstshift@127.0.0.1:5433/{TEST_DB}"
os.environ["FIRSTSHIFT_FAKE_AI"] = "1"
os.environ["FIRSTSHIFT_DATA_DIR"] = tempfile.mkdtemp(prefix="firstshift-test-")


def _database_ready() -> bool:
    try:
        with psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=3) as conn:
            conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
            conn.execute(f"CREATE DATABASE {TEST_DB}")
        return True
    except Exception:
        return False


_READY = _database_ready()


def pytest_collection_modifyitems(config, items):
    if _READY:
        return
    skip = pytest.mark.skip(reason="local TimescaleDB container is not running (make db)")
    for item in items:
        item.add_marker(skip)


@pytest.fixture(scope="session")
def migrated():
    from app import db

    db.migrate()
    yield
    db.close()


@pytest.fixture(scope="session")
def sample_video() -> Path:
    return _root / "reference_vids" / "sittostand_primary.mp4"
