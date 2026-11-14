"""Accounts: sign up, log in, the signed-in user's profile and their agency.

POST  /api/auth/signup   {role, name, email, password} -> user; sets the session cookie
POST  /api/auth/login    {email, password}             -> user; sets the session cookie
POST  /api/auth/logout                                 -> {ok}; clears the cookie
GET   /api/auth/me                                     -> user, with org {id, name, is_sample}; 401 if signed out
GET   /api/auth/session                                -> {user} or {user: null}; never 401
PATCH /api/auth/me       {name, title, credentials, prefs}  prefs are merged
POST  /api/auth/password {current_password, new_password} -> {ok}; signs out the user's other sessions
PATCH /api/org           {name}                        nurses only

Everyone who signs up joins the default agency, so a new nurse and a new caregiver can
work with each other straight away.
"""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import auth, db

router = APIRouter(tags=["accounts"])


class Signup(BaseModel):
    role: str
    name: str
    email: str
    password: str


class Login(BaseModel):
    email: str
    password: str


class ProfilePatch(BaseModel):
    name: str | None = None
    title: str | None = Field(default=None, max_length=80)
    credentials: str | None = Field(default=None, max_length=40)
    prefs: dict[str, bool] | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class OrgPatch(BaseModel):
    name: str


def _signed_in(response: Response, user_id) -> dict:
    auth.set_cookie(response, auth.create_session(user_id))
    return auth.public(auth.get_user(user_id))


@router.post("/auth/signup")
def signup(body: Signup, response: Response):
    name, email = body.name.strip(), body.email.strip().lower()
    if body.role not in ("nurse", "caregiver"):
        raise HTTPException(422, "Choose whether you are signing up as a caregiver or a nurse.")
    if len(name) < 2:
        raise HTTPException(422, "Please add your name.")
    if not auth.EMAIL_RE.match(email):
        raise HTTPException(422, "Enter a valid email address.")
    if len(body.password) < auth.MIN_PASSWORD:
        raise HTTPException(422, f"Choose a password of at least {auth.MIN_PASSWORD} characters.")
    try:
        user_id = auth.create_user(org_id=auth.DEFAULT_ORG, role=body.role, name=name[:120], email=email,
                                   password=body.password)
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "An account with that email already exists. Log in instead.") from None
    return _signed_in(response, user_id)


@router.post("/auth/login")
def login(body: Login, response: Response):
    row = db.fetch_one("SELECT id, password_hash FROM users WHERE email=%s", (body.email.strip().lower(),))
    # Verify against something even when the email is unknown, so both failures take as long.
    if not auth.verify_password(body.password, row["password_hash"] if row else auth.hash_password("-")) or not row:
        raise HTTPException(401, "That email and password don't match an account.")
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


@router.post("/auth/password")
def change_password(body: PasswordChange, request: Request, user: dict = Depends(auth.current_user)):
    """Change the signed-in user's password. The current password has to be given as well,
    so a session left open on a shared device is not enough to take the account over.
    Every other session of the user is ended; the one making the request stays signed in."""
    row = db.fetch_one("SELECT password_hash FROM users WHERE id=%s", (user["id"],))
    if not row or not auth.verify_password(body.current_password, row["password_hash"]):
        raise HTTPException(400, "Your current password isn't right.")
    if len(body.new_password) < auth.MIN_PASSWORD:
        raise HTTPException(422, f"Choose a password of at least {auth.MIN_PASSWORD} characters.")
    if body.new_password == body.current_password:
        raise HTTPException(422, "Choose a new password that is different from your current one.")
    db.execute("UPDATE users SET password_hash=%s WHERE id=%s", (auth.hash_password(body.new_password), user["id"]))
    auth.end_other_sessions(user["id"], auth.token_from(request))
    return {"ok": True}


@router.patch("/org")
def patch_org(body: OrgPatch, user: dict = Depends(auth.nurse)):
    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(422, "Enter the agency's name.")
    db.execute("UPDATE orgs SET name=%s WHERE id=%s", (name[:120], user["org_id"]))
    auth.forget_cached()
    return auth.public(auth.get_user(user["id"]))
