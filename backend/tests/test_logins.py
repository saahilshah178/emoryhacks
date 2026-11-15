"""make logins: six fixed logins with stable passwords (scripts/logins.py).

These tests start from a clean set of listed logins, so they live in their own file, which
runs after the account tests.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app import auth, db
from app.main import app
from scripts import logins

NAMES = ["nurse", "nurse2", "caregiver", "caregiver2", "caregiver3", "caregiver4"]


def _hashes() -> dict[str, str]:
    rows = db.fetch_all("SELECT username, password_hash FROM users WHERE username IS NOT NULL")
    return {r["username"]: r["password_hash"] for r in rows}


def _log_in(username: str, password: str):
    client = TestClient(app)
    client.headers.pop("authorization", None)
    return client, client.post("/api/auth/login", json={"username": username, "password": password})


def _passwords(made: list[dict]) -> dict[str, str]:
    return {m["username"]: m["password"] for m in made}


@pytest.fixture()
def fresh(migrated, tmp_path):
    """Logins made once, in a LOGINS.md under tmp_path; yields (path, passwords)."""
    path = tmp_path / "LOGINS.md"
    # a clean start: nobody has a password, whatever other tests left behind
    db.execute("UPDATE users SET username=NULL, password_hash=NULL WHERE username IS NOT NULL")
    passwords = _passwords(logins.generate(path))
    return path, passwords


def test_the_ids_of_the_people_do_not_change():
    """Production already has these people; their ids come from the helper and must stay."""
    assert str(logins.uid("login:nurse")) == "ff3b87d7-2182-5afa-91c7-51302d2622fe"
    assert str(logins.uid("login:caregiver")) == "8f876a35-9fcc-559f-b73f-7790c99d0ab3"
    assert str(logins.uid("login:caregiver2")) == "5c2384e0-478f-582a-9ccf-e3852cfd0e71"


def test_six_logins_in_the_default_agency(fresh):
    assert [login.username for login in logins.LOGINS] == NAMES
    rows = db.fetch_all("SELECT username, org_id, role FROM users WHERE username IS NOT NULL")
    assert {r["username"] for r in rows} == set(NAMES)
    assert {r["org_id"] for r in rows} == {auth.DEFAULT_ORG}
    assert {r["username"]: r["role"] for r in rows}["nurse2"] == "nurse"


def test_running_it_twice_changes_no_password(fresh):
    path, first = fresh
    before = _hashes()
    client, res = _log_in("nurse", first["nurse"])
    assert res.status_code == 200
    again = logins.generate(path)
    assert [m["status"] for m in again] == ["kept"] * 6
    assert _hashes() == before
    # still signed in, and the file still shows the same passwords
    assert client.get("/api/auth/me").status_code == 200
    assert _passwords(again) == first
    text = path.read_text()
    assert all(f"`{u}` | `{p}`" in text for u, p in first.items())
    assert "Changed in this run: nothing" in text


def test_adding_a_login_creates_only_that_one(fresh, monkeypatch):
    path, first = fresh
    before = _hashes()
    extra = logins.Login("caregiver5", "caregiver", "Pat New", "Home Health Aide")
    monkeypatch.setattr(logins, "LOGINS", [*logins.LOGINS, extra])
    made = logins.generate(path)
    assert {m["username"]: m["status"] for m in made} == {**{n: "kept" for n in NAMES}, "caregiver5": "new"}
    after = _hashes()
    assert {u: h for u, h in after.items() if u != "caregiver5"} == before
    assert _log_in("caregiver5", _passwords(made)["caregiver5"])[1].status_code == 200
    assert "`caregiver5` (new)" in path.read_text()


def test_reset_changes_one_password_and_ends_only_that_session(fresh):
    path, first = fresh
    before = _hashes()
    nurse_client = _log_in("nurse", first["nurse"])[0]
    other = _log_in("caregiver", first["caregiver"])[0]
    made = logins.generate(path, reset=["nurse"])
    after = _hashes()
    assert [u for u in NAMES if after[u] != before[u]] == ["nurse"]
    new = _passwords(made)["nurse"]
    assert new != first["nurse"] and {m["username"]: m["status"] for m in made}["nurse"] == "reset"
    assert nurse_client.get("/api/auth/me").status_code == 401
    assert other.get("/api/auth/me").status_code == 200
    assert _log_in("nurse", first["nurse"])[1].status_code == 401
    assert _log_in("nurse", new)[1].status_code == 200
    text = path.read_text()
    assert first["nurse"] not in text and new in text and first["caregiver"] in text
    assert "Changed in this run: `nurse` (reset)" in text


def test_reset_all_and_unknown_names(fresh):
    path, first = fresh
    before = _hashes()
    with pytest.raises(ValueError, match="nobody"):
        logins.generate(path, reset=["nurse", "nobody"])
    assert _hashes() == before  # an unknown name changes nothing, not even the valid one
    assert logins.main(["--reset", "nurse,nobody"]) == 2
    assert _hashes() == before
    made = logins.generate(path, reset_all=True)
    after = _hashes()
    assert all(after[u] != before[u] for u in NAMES)
    assert all(_passwords(made)[u] != first[u] for u in NAMES)


def test_a_password_that_is_not_recorded_is_not_invented(fresh):
    path, first = fresh
    path.unlink()
    made = logins.generate(path)
    assert [m["password"] for m in made] == [None] * 6  # nothing to carry over, so nothing is claimed
    text = path.read_text()
    assert "unchanged (not recorded here" in text and '--reset nurse2' in text
    assert all(p not in text for p in first.values())
    # a file whose password no longer matches the stored hash is not trusted either
    path.write_text(f"| Nurse | `nurse` | `{'wrong-pass-word'}` | x |\n")
    assert logins.generate(path)[0]["password"] is None
    assert "wrong-pass-word" not in path.read_text()


def test_taking_a_login_off_the_list_clears_its_username(fresh, monkeypatch):
    path, first = fresh
    client = _log_in("caregiver4", first["caregiver4"])[0]
    everyone = logins.LOGINS
    monkeypatch.setattr(logins, "LOGINS", [l for l in logins.LOGINS if l.username != "caregiver4"])
    logins.generate(path)
    row = db.fetch_one("SELECT username FROM users WHERE id=%s", (logins.uid("login:caregiver4"),))
    assert row["username"] is None
    assert client.get("/api/auth/me").status_code == 401
    assert _log_in("caregiver4", first["caregiver4"])[1].status_code == 401
    assert "caregiver4" not in path.read_text().split("| Role")[1]
    # someone who signed up keeps their username, even one a listed login used to have
    stray = auth.create_user(org_id=auth.DEFAULT_ORG, role="caregiver", name="Stray",
                             email=f"{uuid.uuid4().hex[:8]}@x.test", password="long-enough", username="stray")
    taker_email = f"{uuid.uuid4().hex[:8]}@x.test"
    taker = auth.create_user(org_id=auth.DEFAULT_ORG, role="caregiver", name="Taker",
                             email=taker_email, password="long-enough", username="caregiver4")
    logins.generate(path)
    assert db.fetch_one("SELECT username FROM users WHERE id=%s", (stray,))["username"] == "stray"
    assert db.fetch_one("SELECT username FROM users WHERE id=%s", (taker,))["username"] == "caregiver4"
    # once the name is listed again it is taken back, and the person can still log in with their email
    monkeypatch.setattr(logins, "LOGINS", everyone)
    logins.generate(path)
    assert db.fetch_one("SELECT username FROM users WHERE id=%s", (stray,))["username"] == "stray"
    taken_back = db.fetch_one("SELECT username, password_hash FROM users WHERE id=%s", (taker,))
    assert taken_back["username"] is None and taken_back["password_hash"]
    by_email = TestClient(app)
    by_email.headers.pop("authorization", None)
    answer = by_email.post("/api/auth/login", json={"email": taker_email, "password": "long-enough"})
    assert answer.status_code == 200 and answer.json()["id"] == str(taker)
    assert db.fetch_one("SELECT username FROM users WHERE id=%s",
                        (logins.uid("login:caregiver4"),))["username"] == "caregiver4"


def test_logins_never_share_a_hash_and_each_works_only_with_its_own_password(fresh):
    path, passwords = fresh
    hashes = _hashes()
    assert len(set(hashes.values())) == 6 and len(set(passwords.values())) == 6
    for name in NAMES:
        assert _log_in(name, passwords[name])[1].status_code == 200
        for other in NAMES:
            if other != name:
                assert _log_in(name, passwords[other])[1].status_code == 401
