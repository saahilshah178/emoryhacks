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


@pytest.fixture(scope="session", autouse=True)
def signed_in(migrated):
    """Every TestClient a test creates is signed in as a nurse of the default agency, so
    the route tests exercise the pipeline rather than the login. Tests of the login itself
    drop the header: client.headers.pop("authorization")."""
    from fastapi.testclient import TestClient

    from app import auth

    user_id = auth.create_user(org_id=auth.DEFAULT_ORG, role="nurse", name="Test Nurse",
                               email="test.nurse@example.test", password="test-password")
    token = auth.create_session(user_id)
    original = TestClient.__init__

    def init(self, *args, **kwargs):
        original(self, *args, **kwargs)
        self.headers["authorization"] = f"Bearer {token}"

    TestClient.__init__ = init
    yield {"id": user_id, "token": token}
    TestClient.__init__ = original
