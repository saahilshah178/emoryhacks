"""Postgres access for Tiger Data. Small helpers over a psycopg connection pool."""
from __future__ import annotations

import re
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from . import config

_pool: ConnectionPool | None = None
_lock = threading.Lock()
SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def pool() -> ConnectionPool:
    global _pool
    with _lock:
        if _pool is None:
            _pool = ConnectionPool(
                config.DATABASE_URL,
                min_size=1,
                max_size=6,
                kwargs={"row_factory": dict_row, "autocommit": True},
                open=True,
            )
    return _pool


def close() -> None:
    global _pool
    with _lock:
        if _pool is not None:
            _pool.close()
            _pool = None


def J(value: Any) -> Jsonb:
    """Wrap a Python value so psycopg sends it as jsonb."""
    return Jsonb(value)


def fetch_all(sql: str, params: Any = None) -> list[dict]:
    with pool().connection() as conn:
        return conn.execute(sql, params).fetchall()


def fetch_one(sql: str, params: Any = None) -> dict | None:
    with pool().connection() as conn:
        return conn.execute(sql, params).fetchone()


def execute(sql: str, params: Any = None) -> int:
    with pool().connection() as conn:
        return conn.execute(sql, params).rowcount


@contextmanager
def tx() -> Iterator[psycopg.Connection]:
    """A connection inside one transaction; commits on exit, rolls back on error."""
    with pool().connection() as conn:
        with conn.transaction():
            yield conn


def schema_statements() -> list[str]:
    text = SCHEMA_PATH.read_text()
    parts = re.split(r"(?m)^\s*-- @@\s*$", text)
    return [p.strip() for p in parts if p.strip()]


# Any fixed number: the advisory lock that lets one server at a time apply the schema.
MIGRATE_LOCK = 4_718_203_651


def migrate() -> None:
    """Apply schema.sql. Safe to run repeatedly, and from several servers starting at the
    same moment on one database: they take turns. Without that, two sessions running the
    same CREATE TABLE IF NOT EXISTS for a table that does not exist yet can collide, and the
    loser fails to start."""
    with psycopg.connect(config.DATABASE_URL, autocommit=True) as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (MIGRATE_LOCK,))
        try:
            for stmt in schema_statements():
                conn.execute(stmt)
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (MIGRATE_LOCK,))
