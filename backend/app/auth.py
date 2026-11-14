"""Accounts and sessions.

People sign up in the app, or get a username from scripts/logins.py. A login matches a
username or an email. Passwords are stored as scrypt hashes. A login creates a random
session token; the browser keeps it in an HttpOnly cookie and the database keeps only its
SHA-256, so a copy of the sessions table cannot be replayed. Scripts and tests may send
the token as a bearer token.

Routers depend on current_user (any signed-in user) or nurse (nurses only). Both return the
user row with its org's name, is_sample flag and join_code attached.
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
from psycopg import errors as pg_errors

from . import db

COOKIE = "sid"
SESSION_DAYS = 7
UPLOAD_SCOPE = "upload"
UPLOAD_MINUTES = 30
MIN_PASSWORD = 8
DEFAULT_ORG = uuid.UUID("00000000-0000-0000-0000-000000000001")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# No 0/o/1/i/l, so a code read aloud is unambiguous. Stored without the hyphen.
JOIN_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
JOIN_CODE_LENGTH = 8
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


def create_session(user_id, *, scope: str | None = None, minutes: float | None = None) -> str:
    """A new session token for the user. scope None is an ordinary login; a scoped token is
    only accepted where that scope is asked for (see uploader)."""
    token = secrets.token_urlsafe(32)
    life = dt.timedelta(minutes=minutes) if minutes else dt.timedelta(days=SESSION_DAYS)
    db.execute("INSERT INTO sessions (token_hash, user_id, expires_at, scope) VALUES (%s,%s,%s,%s)",
               (_token_hash(token), user_id, dt.datetime.now(dt.timezone.utc) + life, scope))
    return token


def create_upload_ticket(user_id) -> str:
    """A token that lets its holder send videos as this user for UPLOAD_MINUTES and do nothing
    else. The web app hands it to the browser when uploads go straight to the API's own address
    (config.PUBLIC_API_URL), where the login cookie is not sent. Old tickets are cleared here."""
    db.execute("DELETE FROM sessions WHERE scope=%s AND expires_at < now()", (UPLOAD_SCOPE,))
    return create_session(user_id, scope=UPLOAD_SCOPE, minutes=UPLOAD_MINUTES)


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


_USER_SQL = """SELECT u.id, u.org_id, u.role, u.name, u.username, u.email, u.title, u.credentials, u.location, u.hire_date,
                      u.next_shift, u.employment, u.prefs, u.notifications_seen_at, u.created_at,
                      o.name AS org_name, o.is_sample AS org_is_sample, o.join_code AS org_join_code,
                      EXISTS (SELECT 1 FROM users n WHERE n.org_id = u.org_id AND n.role = 'nurse') AS org_has_nurse
               FROM users u JOIN orgs o ON o.id = u.org_id"""


def get_user(user_id) -> dict | None:
    return db.fetch_one(f"{_USER_SQL} WHERE u.id=%s", (user_id,))


def user_for_token(token: str | None, scope: str | None = None) -> dict | None:
    """The user a token belongs to. An ordinary session matches only scope None, and a scoped
    token only its own scope, so an upload ticket cannot be used as a login."""
    if not token:
        return None
    key = _token_hash(token)
    if scope is not None:  # rare, short-lived: not worth caching
        return db.fetch_one(
            f"{_USER_SQL} JOIN sessions s ON s.user_id = u.id "
            "WHERE s.token_hash=%s AND s.scope=%s AND s.expires_at > now()", (key, scope))
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[1] < _CACHE_SECONDS:
            return hit[0]
    user = db.fetch_one(
        f"{_USER_SQL} JOIN sessions s ON s.user_id = u.id "
        "WHERE s.token_hash=%s AND s.scope IS NULL AND s.expires_at > now()", (key,))
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


def uploader(request: Request) -> dict:
    """Who is sending a video: a signed-in user, or the holder of an upload ticket."""
    token = token_from(request)
    user = user_for_token(token) or user_for_token(token, scope=UPLOAD_SCOPE)
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
        "id": user["id"], "role": user["role"], "name": user["name"], "username": user["username"],
        "email": user["email"], "title": user["title"], "credentials": user["credentials"], "location": user["location"],
        "hire_date": user["hire_date"], "next_shift": user["next_shift"], "employment": user["employment"],
        "prefs": {"safety": True, "submissions": True, "digest": False, **(user["prefs"] or {})},
        "created_at": user["created_at"],
        "org": {"id": user["org_id"], "name": user["org_name"], "is_sample": user["org_is_sample"],
                "join_code": format_join_code(user.get("org_join_code")),
                "has_nurse": bool(user.get("org_has_nurse"))},
    }


def _exec(conn, sql: str, params) -> None:
    if conn is None:
        db.execute(sql, params)
    else:
        conn.execute(sql, params)


def _fetch(conn, sql: str, params=None) -> dict | None:
    if conn is None:
        return db.fetch_one(sql, params)
    return conn.execute(sql, params).fetchone()


def new_join_code() -> str:
    return "".join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(JOIN_CODE_LENGTH))


def normalize_join_code(raw: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (raw or "").strip().lower())


def format_join_code(code: str | None) -> str:
    compact = normalize_join_code(code or "")
    if len(compact) == JOIN_CODE_LENGTH:
        return f"{compact[:4]}-{compact[4:]}"
    return compact


def _unused_join_code(conn=None) -> str:
    for _ in range(16):
        code = new_join_code()
        if not _fetch(conn, "SELECT 1 FROM orgs WHERE join_code=%s", (code,)):
            return code
    raise RuntimeError("could not allocate an agency code")


def org_for_code(code: str) -> dict | None:
    compact = normalize_join_code(code)
    if len(compact) != JOIN_CODE_LENGTH:
        return None
    return db.fetch_one("SELECT id, name, is_sample, join_code FROM orgs WHERE join_code=%s", (compact,))


def ensure_join_codes() -> None:
    """Give every existing org a join code. New orgs get one in create_org."""
    for row in db.fetch_all("SELECT id FROM orgs WHERE join_code IS NULL"):
        for _ in range(8):
            try:
                db.execute("UPDATE orgs SET join_code=%s WHERE id=%s AND join_code IS NULL",
                           (_unused_join_code(), row["id"]))
                break
            except pg_errors.UniqueViolation:
                continue


def create_org(*, name: str = "My agency", conn=None) -> uuid.UUID:
    """A new empty agency. Sign-up puts the new person in one of these, so they do not
    inherit the default agency's skills, roster or recordings."""
    org_id = uuid.uuid4()
    _exec(conn, "INSERT INTO orgs (id, name, join_code) VALUES (%s, %s, %s)",
          (org_id, name[:120], _unused_join_code(conn)))
    return org_id


def _drop_empty_org(org_id, conn) -> None:
    if str(org_id) == str(DEFAULT_ORG):
        return
    leftover = conn.execute("SELECT count(*) AS n FROM users WHERE org_id=%s", (org_id,)).fetchone()
    skills = conn.execute("SELECT 1 FROM skills WHERE org_id=%s LIMIT 1", (org_id,)).fetchone()
    if leftover and leftover["n"] == 0 and not skills:
        conn.execute("DELETE FROM orgs WHERE id=%s", (org_id,))


def join_agency(user: dict, code: str) -> dict:
    """Move the signed-in person into the agency that owns this code. Caregivers can
    always move. A nurse can only leave an agency that has no skills and no other people."""
    target = org_for_code(code)
    if not target:
        raise HTTPException(422, "That agency code does not match an agency.")
    if str(target["id"]) == str(user["org_id"]):
        raise HTTPException(422, "You already belong to that agency.")
    if user["role"] == "nurse":
        if db.fetch_one("SELECT 1 FROM skills WHERE org_id=%s LIMIT 1", (user["org_id"],)):
            raise HTTPException(
                422, "A nurse whose agency already has skills cannot join another. Share your code instead.")
        if db.fetch_one("SELECT 1 FROM users WHERE org_id=%s AND id<>%s LIMIT 1", (user["org_id"], user["id"])):
            raise HTTPException(
                422, "A nurse whose agency already has people cannot join another. Share your code, or have them join first.")
    old = user["org_id"]
    with db.tx() as conn:
        conn.execute("UPDATE users SET org_id=%s WHERE id=%s", (target["id"], user["id"]))
        _drop_empty_org(old, conn)
    forget_cached()
    return get_user(user["id"])


def unique_username(email: str) -> str:
    """A username derived from the email local-part, unique among existing usernames."""
    local = email.split("@", 1)[0].lower()
    base = re.sub(r"[^a-z0-9]+", "", local)[:24] or "user"
    n = 0
    while True:
        candidate = base if n == 0 else f"{base}{n}"
        if not db.fetch_one("SELECT 1 FROM users WHERE lower(username)=%s", (candidate,)):
            return candidate
        n = n + 1 if n else 2


def create_user(*, org_id, role: str, name: str, email: str, password: str | None, conn=None, **profile) -> uuid.UUID:
    user_id = uuid.uuid4()
    columns = {"id": user_id, "org_id": org_id, "role": role, "name": name, "email": email.strip().lower(),
               "password_hash": hash_password(password) if password else None, **profile}
    if "prefs" in columns:
        columns["prefs"] = db.J(columns["prefs"])
    _exec(conn, f"INSERT INTO users ({', '.join(columns)}) VALUES ({', '.join(['%s'] * len(columns))})",
          tuple(columns.values()))
    return user_id
