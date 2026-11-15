"""Make the fixed set of logins and write them to LOGINS.md.

  uv run python -m scripts.logins                       (make logins)
  uv run python -m scripts.logins --reset nurse,caregiver2
  uv run python -m scripts.logins --reset-all

The people in LOGINS below are the shared agency logins. Anyone can also sign up in the app;
those accounts keep their username and password when this script runs. A run changes as
little as it can:

  - a listed login that already exists with a password keeps it, and stays signed in;
  - a listed login that does not exist yet (or has no password) gets a new random password;
  - --reset gives only the named logins a new password and signs only them out;
    --reset-all does so for every listed login;
  - a reserved username sitting on the wrong person is taken back;
  - a line taken out of LOGINS clears that person's username, password and sessions.

LOGINS.md in the repository root is rewritten each run. It is gitignored. The database keeps
only hashes, so the file is the only copy of the passwords. A password made in this run is
shown; one left alone is carried over from the old file if it still matches the stored hash,
and otherwise the file says it is not recorded and how to reset it. The whole run is one
transaction: either everything changes or nothing does.
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import secrets
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

from app import auth, config, db

LOGINS_FILE = config.ROOT / "LOGINS.md"
# Letters and digits that are hard to mix up when read off a screen (no i, l, o, 0, 1).
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
# Fixed namespace for the ids of the people made here. Existing databases already hold people
# with these ids, so it must never change.
_NAMESPACE = uuid.UUID("6f1c3a52-7d4e-5b8a-9c21-4e0d8b7a1f30")


def uid(key: str) -> uuid.UUID:
    """The stable id derived from a key, e.g. uid("login:nurse")."""
    return uuid.uuid5(_NAMESPACE, key)


@dataclass(frozen=True)
class Login:
    username: str
    role: str
    name: str
    title: str = ""
    credentials: str = ""

    @property
    def user_id(self) -> uuid.UUID:
        return uid(f"login:{self.username}")


LOGINS = [
    Login("nurse", "nurse", "Morgan Reyes", "Clinical Supervisor", "RN"),
    Login("nurse2", "nurse", "Dana Whitfield", "Clinical Educator", "RN"),
    Login("caregiver", "caregiver", "Jamie Carter", "Home Health Aide"),
    Login("caregiver2", "caregiver", "Riley Nguyen", "Certified Nursing Assistant"),
    Login("caregiver3", "caregiver", "Sam Okafor", "Home Health Aide"),
    Login("caregiver4", "caregiver", "Alex Moreno", "Personal Care Aide"),
]


def new_password() -> str:
    """Twelve random characters in three groups, e.g. kfwm-t7zr-hx3d (about 59 bits)."""
    return "-".join("".join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(3))


def _ensure_person(conn, login: Login) -> None:
    # Caregivers start onboarding. A nurse marks them active once they are cleared for shifts.
    employment = "onboarding" if login.role == "caregiver" else "active"
    conn.execute(
        "INSERT INTO users (id, org_id, role, name, email, title, credentials, employment) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
        (login.user_id, auth.DEFAULT_ORG, login.role, login.name, f"{login.username}@firstshift.example",
         login.title, login.credentials, employment))


def parse_names(text: str) -> list[str]:
    return [n.strip() for n in text.split(",") if n.strip()]


def generate(path: Path | None = LOGINS_FILE, reset: list[str] | tuple[str, ...] = (),
             reset_all: bool = False) -> list[dict]:
    """Bring the logins to the state described at the top of this file.

    Returns one dict per login: username, role, name, status ("new", "reset" or "kept") and
    password (the new one for new and reset logins; for a kept one, the recorded password if
    it still verifies, else None). Raises ValueError, changing nothing, if reset names a
    login that is not in LOGINS. Writes the file unless path is None.
    """
    known = {login.username for login in LOGINS}
    unknown = [n for n in reset if n not in known]
    if unknown:
        raise ValueError(f"unknown login{'s' if len(unknown) > 1 else ''}: {', '.join(unknown)}; "
                         f"the logins are {', '.join(login.username for login in LOGINS)}")
    forced = known if reset_all else set(reset)
    previous = _recorded_passwords(path)
    db.migrate()
    made: list[dict] = []
    with db.tx() as conn:  # one transaction: either every change happens or none does
        for login in LOGINS:
            _ensure_person(conn, login)
        reserved = [login.username for login in LOGINS]
        managed_ids = [login.user_id for login in LOGINS]
        # A reserved name on the wrong person is taken back; they can still log in with email.
        stolen = conn.execute(
            "SELECT id FROM users WHERE username = ANY(%s) AND NOT (id = ANY(%s))",
            (reserved, managed_ids)).fetchall()
        stolen_ids = [row["id"] for row in stolen]
        if stolen_ids:
            conn.execute("UPDATE users SET username=NULL WHERE id = ANY(%s)", (stolen_ids,))
        # A listed login taken out of LOGINS loses the username, password and sessions.
        held = conn.execute(
            "SELECT id, username FROM users WHERE username IS NOT NULL AND NOT (id = ANY(%s))",
            (managed_ids,)).fetchall()
        former_ids = [row["id"] for row in held if row["id"] == uid(f"login:{row['username']}")]
        if former_ids:
            conn.execute("UPDATE users SET username=NULL, password_hash=NULL WHERE id = ANY(%s)", (former_ids,))
            conn.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (former_ids,))
        stale_ids = stolen_ids + former_ids
        for login in LOGINS:
            row = conn.execute("SELECT username, password_hash FROM users WHERE id=%s", (login.user_id,)).fetchone()
            keep = row["username"] == login.username and row["password_hash"] and login.username not in forced
            entry = {"username": login.username, "role": login.role, "name": login.name,
                     "status": "kept", "password": None}
            if keep:
                recorded = previous.get(login.username)
                if recorded and auth.verify_password(recorded, row["password_hash"]):
                    entry["password"] = recorded
            else:
                entry["status"] = "reset" if row["password_hash"] else "new"
                entry["password"] = new_password()
                conn.execute("UPDATE users SET username=%s, password_hash=%s WHERE id=%s",
                             (login.username, auth.hash_password(entry["password"]), login.user_id))
                conn.execute("DELETE FROM sessions WHERE user_id=%s", (login.user_id,))
            made.append(entry)
    auth.forget_cached()
    if path is not None:
        path.write_text(_markdown(made, len(stale_ids)))
    return made


_ROW = re.compile(r"^\|[^|]*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|", re.M)


def _recorded_passwords(path: Path | None) -> dict[str, str]:
    """username -> password from an existing LOGINS.md (checked against the database by the caller)."""
    try:
        return dict(_ROW.findall(path.read_text())) if path else {}
    except OSError:
        return {}


def _markdown(made: list[dict], removed: int) -> str:
    when = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    changed = [m for m in made if m["status"] != "kept"]
    lines = [
        "# Logins",
        "",
        f"Made by `make logins` on {when}. Shared agency logins; people can also sign up in the app.",
        "",
        ("Changed in this run: " + ", ".join(f"`{m['username']}` ({m['status']})" for m in changed) + "."
         if changed else "Changed in this run: nothing."),
    ]
    if removed:
        lines.append(f"{removed} other account(s) lost their username and can no longer sign in.")
    lines += [
        "",
        "This file is not in git and must stay out of it: the repository is public. The database",
        "keeps only hashes, so this is the only copy of the passwords. A login that was left alone",
        "keeps its password; reset one with `make logins ARGS=\"--reset <name>\"`.",
        "",
        "| Role | Username | Password | Person |", "| --- | --- | --- | --- |",
    ]
    for m in made:
        password = (f"`{m['password']}`" if m["password"] else
                    f"unchanged (not recorded here; reset it with `make logins ARGS=\"--reset {m['username']}\"`)")
        lines.append(f"| {m['role'].capitalize()} | `{m['username']}` | {password} | {m['name']} |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="logins", description="Make the fixed set of logins and write LOGINS.md.")
    parser.add_argument("--reset", default="", metavar="NAME[,NAME...]",
                        help="give only these logins a new password and sign only them out")
    parser.add_argument("--reset-all", action="store_true", help="give every login a new password")
    args = parser.parse_args(argv)
    try:
        made = generate(reset=parse_names(args.reset), reset_all=args.reset_all)
    except ValueError as error:
        print(f"Error: {error}. Nothing was changed.", file=sys.stderr)
        return 2
    changed = [m for m in made if m["status"] != "kept"]
    print(f"{len(changed)} of {len(made)} logins changed. Usernames and passwords are in {LOGINS_FILE}")
    for m in made:
        print(f"  {m['role']:<9} {m['username']:<12} {m['name']:<16} {m['status']}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        db.close()
