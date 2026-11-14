"""Accounts: log in, the signed-in user's profile and their agency.

POST  /api/auth/login    {username, password}          -> user; sets the session cookie
POST  /api/auth/logout                                 -> {ok}; clears the cookie
GET   /api/auth/me                                     -> user, with org {id, name, is_sample}; 401 if signed out
GET   /api/auth/session                                -> {user} or {user: null}; never 401
PATCH /api/auth/me       {name, title, credentials, prefs}  prefs are merged
PATCH /api/org           {name}                        nurses only

There is no sign-up and no way to change a password here. The logins are a fixed set made
by scripts/logins.py (make logins), which writes the usernames and passwords to LOGINS.md.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import auth, db

router = APIRouter(tags=["accounts"])


class Login(BaseModel):
    username: str
    password: str


class ProfilePatch(BaseModel):
    name: str | None = None
    title: str | None = Field(default=None, max_length=80)
    credentials: str | None = Field(default=None, max_length=40)
    prefs: dict[str, bool] | None = None


class OrgPatch(BaseModel):
    name: str


def _signed_in(response: Response, user_id) -> dict:
    auth.set_cookie(response, auth.create_session(user_id))
    return auth.public(auth.get_user(user_id))


@router.post("/auth/login")
def login(body: Login, response: Response):
    row = db.fetch_one("SELECT id, password_hash FROM users WHERE lower(username)=%s",
                       (body.username.strip().lower(),))
    # Verify against something even when the username is unknown, so both failures take as long.
    if not auth.verify_password(body.password, row["password_hash"] if row else auth.hash_password("-")) or not row:
        raise HTTPException(401, "That username and password don't match a login.")
    return _signed_in(response, row["id"])


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    auth.end_session(auth.token_from(request))
    auth.clear_cookie(response)
    return {"ok": True}


@router.get("/auth/me")
def me(user: dict = Depends(auth.current_user)):
    return auth.public(user)


@router.get("/auth/session")
def session(request: Request):
    """Who is signed in, or {"user": null}. Unlike /auth/me this never answers 401, so a
    public page can ask without logging an error in the visitor's browser console."""
    user = auth.user_for_token(auth.token_from(request))
    return {"user": auth.public(user) if user else None}


@router.patch("/auth/me")
def patch_me(body: ProfilePatch, user: dict = Depends(auth.current_user)):
    sets, params = [], []
    if body.name is not None:
        if len(body.name.strip()) < 2:
            raise HTTPException(422, "Please add your name.")
        sets.append("name=%s")
        params.append(body.name.strip()[:120])
    for column in ("title", "credentials"):
        value = getattr(body, column)
        if value is not None:
            sets.append(f"{column}=%s")
            params.append(value.strip())
    if body.prefs is not None:
        sets.append("prefs = prefs || %s")
        params.append(db.J(body.prefs))
    if sets:
        db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=%s", (*params, user["id"]))
        auth.forget_cached(user["id"])
    return auth.public(auth.get_user(user["id"]))


@router.patch("/org")
def patch_org(body: OrgPatch, user: dict = Depends(auth.nurse)):
    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(422, "Enter the agency's name.")
    db.execute("UPDATE orgs SET name=%s WHERE id=%s", (name[:120], user["org_id"]))
    auth.forget_cached()
    return auth.public(auth.get_user(user["id"]))
