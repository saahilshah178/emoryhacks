"""Accounts: sign up, log in, the signed-in user's profile and their agency.

POST  /api/auth/signup   {role, name, email, password, join_code?} -> user; sets the session cookie
POST  /api/auth/login    {username or email, password} -> user; sets the session cookie
POST  /api/auth/logout                                 -> {ok}; clears the cookie
GET   /api/auth/me                                     -> user, with org {id, name, is_sample, join_code, has_nurse}; 401 if signed out
                                                          (join_code is "" for a caregiver: only nurses are sent it)
GET   /api/auth/session                                -> {user} or {user: null}; never 401
PATCH /api/auth/me       {name, title, credentials, prefs}  prefs are merged
PATCH /api/org           {name}                        nurses only
POST  /api/org/join      {code}                        move into the agency that owns that code

Everyone who signs up gets a new empty agency unless they send a join_code, which puts
them in that agency instead. The six agency logins from scripts/logins.py stay as they
are; sign-up adds more people rather than replacing them.
"""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, model_validator

from .. import auth, db

router = APIRouter(tags=["accounts"])


class Signup(BaseModel):
    role: str
    name: str
    email: str
    password: str
    join_code: str | None = None


class Login(BaseModel):
    password: str
    username: str | None = None
    email: str | None = None

    @model_validator(mode="after")
    def need_identifier(self):
        if not (self.username and self.username.strip()) and not (self.email and self.email.strip()):
            raise ValueError("Enter your username or email.")
        return self


class ProfilePatch(BaseModel):
    name: str | None = None
    title: str | None = Field(default=None, max_length=80)
    credentials: str | None = Field(default=None, max_length=40)
    prefs: dict[str, bool] | None = None


class OrgPatch(BaseModel):
    name: str


class OrgJoin(BaseModel):
    code: str


def _signed_in(response: Response, user_id) -> dict:
    auth.set_cookie(response, auth.create_session(user_id))
    return auth.public(auth.get_user(user_id))


def _email_taken(exc: BaseException) -> bool:
    """Whether a unique violation is the email's. The other one is the username, which a
    sign-up at the same moment took; that is retried with the next free name."""
    constraint = getattr(getattr(exc, "diag", None), "constraint_name", None) or ""
    return "email" in constraint.lower()


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
    target = None
    if (body.join_code or "").strip():
        target = auth.org_for_code(body.join_code)
        if not target:
            raise HTTPException(422, "That agency code does not match an agency.")
    user_id = None
    for _ in range(4):
        try:
            with db.tx() as conn:
                org_id = target["id"] if target else auth.create_org(conn=conn)
                # As with the listed logins: a caregiver starts onboarding, a nurse does not.
                user_id = auth.create_user(org_id=org_id, role=body.role, name=name[:120],
                                           email=email, password=body.password,
                                           username=auth.unique_username(email),
                                           employment="onboarding" if body.role == "caregiver" else "active",
                                           conn=conn)
            break
        except psycopg.errors.UniqueViolation as exc:
            if _email_taken(exc):
                raise HTTPException(409, "An account with that email already exists. Log in instead.") from None
        except psycopg.errors.ForeignKeyViolation:
            # The agency was deleted (its last person left) after the code was looked up.
            raise HTTPException(422, "That agency code does not match an agency.") from None
    if user_id is None:  # every try lost its username to another sign-up at the same moment
        raise HTTPException(409, "That did not go through. Please try again.")
    return _signed_in(response, user_id)


@router.post("/auth/login")
def login(body: Login, response: Response):
    ident = ((body.username or "").strip() or (body.email or "").strip()).lower()
    row = db.fetch_one("SELECT id, password_hash FROM users WHERE lower(username)=%s OR email=%s",
                       (ident, ident))
    # Verify against something even when the login is unknown, so both failures take as long.
    if not auth.verify_password(body.password, row["password_hash"] if row else auth.hash_password("-")) or not row:
        raise HTTPException(401, "That username or email and password don't match an account.")
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


@router.post("/org/join")
def join_org(body: OrgJoin, user: dict = Depends(auth.current_user)):
    return auth.public(auth.join_agency(user, body.code))
