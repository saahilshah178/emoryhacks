"""Accounts and sessions.

Passwords are stored as scrypt hashes. A login creates a random session token; the browser
keeps it in an HttpOnly cookie and the database keeps only its SHA-256, so a copy of the
sessions table cannot be replayed. Scripts and tests may send the token as a bearer token.

Routers depend on current_user (any signed-in user) or nurse (nurses only). Both return the
user row with its org's name and is_sample flag attached.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import re
import secrets
import threading
import time
import uuid

from fastapi import Depends, HTTPException, Request, Response

from . import db

COOKIE = "sid"
SESSION_DAYS = 7
MIN_PASSWORD = 8
DEFAULT_ORG = uuid.UUID("00000000-0000-0000-0000-000000000001")
SAMPLE_ORG = uuid.UUID("00000000-0000-0000-0000-0000000000a1")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1, "dklen": 32}

# token hash -> (user, time read). Saves a database round trip on every request of a page
# load; short enough that a profile change or a logout elsewhere shows up within seconds.
_CACHE_SECONDS = 15
_cache: dict[str, tuple[dict, float]] = {}
_cache_lock = threading.Lock()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    try:
        scheme, salt, digest = (stored or "").split("$")
        if scheme != "scrypt":
            return False
        candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **_SCRYPT)
        return hmac.compare_digest(candidate, bytes.fromhex(digest))
    except ValueError:
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(user_id) -> str:
    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s,%s,%s)",
               (_token_hash(token), user_id, dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=SESSION_DAYS)))
    return token


def end_session(token: str | None) -> None:
    if not token:
        return
    key = _token_hash(token)
    db.execute("DELETE FROM sessions WHERE token_hash=%s", (key,))
    with _cache_lock:
        _cache.pop(key, None)


def forget_cached(user_id=None) -> None:
    """Drop cached users so the next request reads them again (after a profile or org change)."""
    with _cache_lock:
        if user_id is None:
            _cache.clear()
        else:
            for key in [k for k, (u, _) in _cache.items() if u["id"] == user_id]:
                _cache.pop(key, None)


_USER_SQL = """SELECT u.id, u.org_id, u.role, u.name, u.email, u.title, u.credentials, u.location, u.hire_date,
                      u.next_shift, u.employment, u.prefs, u.notifications_seen_at, u.created_at,
                      o.name AS org_name, o.is_sample AS org_is_sample
               FROM users u JOIN orgs o ON o.id = u.org_id"""


def get_user(user_id) -> dict | None:
    return db.fetch_one(f"{_USER_SQL} WHERE u.id=%s", (user_id,))


def user_for_token(token: str | None) -> dict | None:
    if not token:
        return None
    key = _token_hash(token)
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[1] < _CACHE_SECONDS:
            return hit[0]
    user = db.fetch_one(
        f"{_USER_SQL} JOIN sessions s ON s.user_id = u.id WHERE s.token_hash=%s AND s.expires_at > now()", (key,))
    with _cache_lock:
        if user:
            _cache[key] = (user, time.monotonic())
        else:
            _cache.pop(key, None)
    return user


def token_from(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.cookies.get(COOKIE)


def set_cookie(response: Response, token: str) -> None:
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", path="/")


def clear_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


def current_user(request: Request) -> dict:
    user = user_for_token(token_from(request))
    if not user:
        raise HTTPException(401, "Log in to continue.")
    return user


def nurse(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "nurse":
        raise HTTPException(403, "Only a nurse can do that.")
    return user


def public(user: dict) -> dict:
    """The user as the API returns it."""
    return {
        "id": user["id"], "role": user["role"], "name": user["name"], "email": user["email"],
        "title": user["title"], "credentials": user["credentials"], "location": user["location"],
        "hire_date": user["hire_date"], "next_shift": user["next_shift"], "employment": user["employment"],
        "prefs": {"safety": True, "submissions": True, "digest": False, **(user["prefs"] or {})},
        "created_at": user["created_at"],
        "org": {"id": user["org_id"], "name": user["org_name"], "is_sample": user["org_is_sample"]},
    }


def create_user(*, org_id, role: str, name: str, email: str, password: str | None, **profile) -> uuid.UUID:
    user_id = uuid.uuid4()
    columns = {"id": user_id, "org_id": org_id, "role": role, "name": name, "email": email.strip().lower(),
               "password_hash": hash_password(password) if password else None, **profile}
    if "prefs" in columns:
        columns["prefs"] = db.J(columns["prefs"])
    db.execute(f"INSERT INTO users ({', '.join(columns)}) VALUES ({', '.join(['%s'] * len(columns))})",
               tuple(columns.values()))
    return user_id
