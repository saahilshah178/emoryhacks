"""Make the fixed set of logins and write them to LOGINS.md.

  uv run python -m scripts.logins        (make logins)

Nobody signs up or changes a password in the app: the people in LOGINS below are the only
ones who can log in. Every run gives each of them a new random password, signs them out,
and rewrites LOGINS.md in the repository root with the usernames and passwords.

LOGINS.md is gitignored. The database keeps only password hashes, so that file is the only
copy of the passwords; running this again replaces all of them. Anyone else who had a
username loses it, so taking a line out of LOGINS and running this removes that login.

The two agencies:
  the default agency   the one the reference videos and real attempts belong to. Its three
                       people are created here if they do not exist yet.
  Harbor Home Care     the sample agency. Its logins go to people from scripts/sample_data.py
                       and are skipped until that agency has been loaded (make sample).
                       Loading it again keeps the logins made here.
"""
from __future__ import annotations

import datetime as dt
import secrets
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

from app import auth, config, db
from scripts import sample_data as S

LOGINS_FILE = config.ROOT / "LOGINS.md"
# Letters and digits that are hard to mix up when read off a screen (no i, l, o, 0, 1).
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


@dataclass(frozen=True)
class Login:
    username: str
    role: str
    name: str
    # A person of the sample agency, by their key in sample_data. Otherwise the login
    # belongs to the default agency and the fields below describe the person to create.
    sample_key: str | None = None
    title: str = ""
    credentials: str = ""


LOGINS = [
    Login("nurse", "nurse", "Morgan Reyes", title="Clinical Supervisor", credentials="RN"),
    Login("caregiver", "caregiver", "Jamie Carter", title="Home Health Aide"),
    Login("caregiver2", "caregiver", "Riley Nguyen", title="Certified Nursing Assistant"),
    Login("harbor.nurse", "nurse", "Patricia Chen", sample_key="p.chen"),
    Login("harbor.nurse2", "nurse", "Daniel Okoye", sample_key="d.okoye"),
    Login("harbor.caregiver", "caregiver", "Sarah Chen", sample_key="s.chen"),
    Login("harbor.caregiver2", "caregiver", "Sarah Johnson", sample_key="cg-sarah"),
    Login("harbor.caregiver3", "caregiver", "Michael Brown", sample_key="cg-michael"),
]


def new_password() -> str:
    """Twelve random characters in three groups, e.g. kfwm-t7zr-hx3d (about 59 bits)."""
    return "-".join("".join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(3))


def _person(conn, login: Login) -> uuid.UUID | None:
    """The id of the user this login belongs to, creating a default-agency person who is
    missing. None for a sample person when the sample agency has not been loaded."""
    if login.sample_key:
        user_id = S.uid(f"user:{login.sample_key}")
        return user_id if conn.execute("SELECT 1 FROM users WHERE id=%s", (user_id,)).fetchone() else None
    user_id = S.uid(f"login:{login.username}")
    conn.execute(
        "INSERT INTO users (id, org_id, role, name, email, title, credentials, employment) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,'active') ON CONFLICT (id) DO NOTHING",
        (user_id, auth.DEFAULT_ORG, login.role, login.name, f"{login.username}@firstshift.example",
         login.title, login.credentials))
    return user_id


def generate(path: Path | None = LOGINS_FILE) -> list[dict]:
    """Give every login a new password and return [{username, password, role, name, agency}].
    Sample logins whose person does not exist are left out. Writes the file unless path is None."""
    db.migrate()
    made: list[dict] = []
    with db.tx() as conn:  # one transaction: either every password changes or none does
        users = {login.username: _person(conn, login) for login in LOGINS}
        ids = [user_id for user_id in users.values() if user_id]
        # Only the people listed here keep a username. Clearing first also lets a username
        # move from one person to another without tripping the unique index.
        conn.execute("UPDATE users SET username=NULL WHERE username IS NOT NULL")
        conn.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
        for login in LOGINS:
            user_id = users[login.username]
            if not user_id:
                continue
            password = new_password()
            conn.execute("UPDATE users SET username=%s, password_hash=%s WHERE id=%s",
                         (login.username, auth.hash_password(password), user_id))
            agency = conn.execute("SELECT o.name FROM orgs o JOIN users u ON u.org_id=o.id WHERE u.id=%s",
                                  (user_id,)).fetchone()["name"]
            made.append({"username": login.username, "password": password, "role": login.role,
                         "name": login.name, "agency": agency, "sample": bool(login.sample_key)})
    auth.forget_cached()
    if path is not None:
        path.write_text(_markdown(made))
    return made


def _markdown(made: list[dict]) -> str:
    when = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Logins",
        "",
        f"Made by `make logins` on {when}. These are the only accounts that can sign in.",
        "",
        "This file is not in git and must stay out of it: the repository is public. The database",
        "keeps only hashes, so this is the only copy of the passwords. Running `make logins` again",
        "replaces every password below, for the live site and for local runs alike (they share",
        "one database).",
    ]
    notes = {False: "the reference videos and real grading", True: "sample data to look around in"}
    for sample in (False, True):
        rows = [m for m in made if m["sample"] is sample]
        if not rows:
            continue
        lines += ["", f"## {rows[0]['agency']} ({notes[sample]})", "",
                  "| Role | Username | Password | Person |", "| --- | --- | --- | --- |"]
        lines += [f"| {m['role'].capitalize()} | `{m['username']}` | `{m['password']}` | {m['name']} |" for m in rows]
    return "\n".join(lines) + "\n"


def main() -> int:
    made = generate()
    missing = [login.username for login in LOGINS if login.username not in {m["username"] for m in made}]
    print(f"{len(made)} logins made. Usernames and passwords are in {LOGINS_FILE}")
    for m in made:
        print(f"  {m['role']:<9} {m['username']:<18} {m['name']} ({m['agency']})")
    if missing:
        print(f"Skipped {', '.join(missing)}: the sample agency is not loaded. Run `make sample`, then this again.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        db.close()
