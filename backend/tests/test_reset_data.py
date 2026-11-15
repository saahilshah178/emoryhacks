"""make reset-data: start the data from scratch (scripts/reset_data.py)."""
import uuid

import pytest

from app import auth, config, db, jobs, media, repo
from scripts import reset_data


def _make_org(sample_video):
    """A second agency with a nurse, a caregiver, a skill and two graded attempts."""
    org_id = uuid.uuid4()
    db.execute("INSERT INTO orgs (id, name) VALUES (%s, %s)", (org_id, "Second Agency"))
    nurse = auth.create_user(org_id=org_id, role="nurse", name="Second Nurse",
                             email=f"{uuid.uuid4().hex[:8]}@second.test", password="long-enough", username="second.nurse")
    caregiver = auth.create_user(org_id=org_id, role="caregiver", name="Second Caregiver",
                                 email=f"{uuid.uuid4().hex[:8]}@second.test", password="long-enough")
    auth.create_session(nurse)
    skill_id, ref_id = _skill(sample_video, f"other_{uuid.uuid4().hex[:6]}", org_id)
    attempts = [_attempt(sample_video, skill_id, caregiver, org_id) for _ in range(2)]
    return {"org": org_id, "users": [nurse, caregiver], "skill": skill_id, "ref": ref_id, "attempts": attempts}


def _skill(sample_video, slug, org_id=None):
    ref = jobs.ingest(str(sample_video), "reference", sample_video.name, org_id)
    job_id = repo.create_job("reference", ref["id"])
    jobs.run_reference(job_id, slug=slug, name=f"Skill {slug}")
    return repo.get_job(job_id)["skill_id"], ref["id"]


def _attempt(sample_video, skill_id, caregiver_id, org_id=None):
    video = jobs.ingest(str(sample_video), "attempt", "attempt.mp4", org_id)
    attempt_id = repo.create_attempt(skill_id, video["id"], "Someone", caregiver_id=caregiver_id)
    jobs.run_attempt(repo.create_job("attempt", video["id"], skill_id=skill_id, attempt_id=attempt_id))
    return {"attempt": attempt_id, "video": video["id"]}


def _n(sql, *params) -> int:
    return db.fetch_one(f"SELECT count(*) AS n FROM ({sql}) q", params)["n"]


def _frames(video_id) -> int:
    return _n("SELECT 1 FROM pose_frames WHERE video_id=%s", video_id)


@pytest.fixture(scope="module")
def world(migrated, sample_video, signed_in):
    """Two agencies' worth of data, and the session-wide test nurse protected from the reset
    by giving that account a username for the duration."""
    db.execute("UPDATE users SET username='reset.test.nurse' WHERE id=%s", (signed_in["id"],))
    other = _make_org(sample_video)
    skill_id, ref_id = _skill(sample_video, f"mine_{uuid.uuid4().hex[:6]}")
    login = auth.create_user(org_id=auth.DEFAULT_ORG, role="caregiver", name="Has Login",
                             email=f"{uuid.uuid4().hex[:8]}@mine.test", password="long-enough",
                             username=f"has{uuid.uuid4().hex[:8]}")
    leftover = auth.create_user(org_id=auth.DEFAULT_ORG, role="caregiver", name="Old Signup",
                                email=f"{uuid.uuid4().hex[:8]}@mine.test", password="long-enough")
    auth.create_session(leftover)
    login_token = auth.create_session(login)
    mine = [_attempt(sample_video, skill_id, login) for _ in range(2)]
    db.execute("UPDATE users SET notifications_seen_at=now() WHERE id=ANY(%s)", ([login, leftover, signed_in["id"]],))
    orphan_video = uuid.uuid4()
    orphans = [config.VIDEO_DIR / f"{orphan_video}.mp4", config.THUMB_DIR / f"{orphan_video}_000100.jpg"]
    for path in orphans:
        path.write_bytes(b"x" * 1000)
    yield {"other": other, "skill": skill_id, "ref": ref_id, "login": login, "leftover": leftover,
           "mine": mine, "token": login_token, "orphans": orphans, "test_nurse": signed_in["id"]}
    db.execute("UPDATE users SET username=NULL WHERE id=%s", (signed_in["id"],))


def _snapshot() -> dict[str, int]:
    return {t: _n(f"SELECT 1 FROM {t}") for t in
            ("orgs", "users", "sessions", "skills", "skill_steps", "videos", "attempts", "attempt_steps",
             "order_violations", "safety_flags", "jobs", "pose_tracks", "pose_frames", "gemini_calls")}


def test_the_dry_run_changes_nothing(world):
    before = _snapshot()
    seen = _n("SELECT 1 FROM users WHERE notifications_seen_at IS NOT NULL")
    report = reset_data.run(yes=False, files=True)
    assert report["done"] is False
    assert _snapshot() == before
    assert _n("SELECT 1 FROM users WHERE notifications_seen_at IS NOT NULL") == seen
    assert all(p.exists() for p in world["orphans"])
    counts = report["counts"]
    assert counts["orgs"] >= 1 and "Second Agency" in report["orgs"]
    assert any("Second Caregiver" in u for u in report["users"]) and any("Old Signup" in u for u in report["users"])
    assert counts["attempts"] >= 4 and counts["videos"] >= 4 + 1  # four attempt videos and the other agency's reference
    assert counts["skills"] >= 1 and counts["pose_frames"] > 0
    # the two stray files, plus the files of the five videos that would go (4 attempts, 1 reference)
    assert report["files"] >= 7 and report["megabytes"] > 0.002
    assert reset_data.main([]) == 0 and _snapshot() == before  # the command line says what it would do


def test_the_reset_deletes_exactly_what_it_should(world):
    other, mine = world["other"], world["mine"]
    kept_before = {
        "skill_steps": _n("SELECT 1 FROM skill_steps WHERE skill_id=%s", world["skill"]),
        "ref_frames": _frames(world["ref"]),
        "ref_tracks": _n("SELECT 1 FROM pose_tracks WHERE video_id=%s", world["ref"]),
        "gemini": _n("SELECT 1 FROM gemini_calls"),
        "hash": db.fetch_one("SELECT password_hash FROM users WHERE id=%s", (world["login"],))["password_hash"],
    }
    assert _frames(other["attempts"][0]["video"]) > 0 and _frames(mine[0]["video"]) > 0
    for item in (*other["attempts"], *mine):
        assert media.video_path(item["video"]).exists()

    report = reset_data.run(yes=True, files=True)
    assert report["done"] is True and report["files"] >= 7

    # the other agency is gone with everything that belonged to it
    assert _n("SELECT 1 FROM orgs WHERE id=%s", other["org"]) == 0
    assert _n("SELECT 1 FROM users WHERE id=ANY(%s)", other["users"]) == 0
    assert _n("SELECT 1 FROM sessions WHERE user_id=ANY(%s)", other["users"]) == 0
    assert _n("SELECT 1 FROM skills WHERE id=%s", other["skill"]) == 0
    assert _n("SELECT 1 FROM skill_steps WHERE skill_id=%s", other["skill"]) == 0
    assert _n("SELECT 1 FROM videos WHERE org_id=%s", other["org"]) == 0
    assert _frames(other["ref"]) == 0
    # every attempt is gone, with its video, rows and pose data, in both agencies
    assert _n("SELECT 1 FROM attempts") == 0
    assert _n("SELECT 1 FROM videos WHERE kind='attempt'") == 0
    for item in (*other["attempts"], *mine):
        assert _frames(item["video"]) == 0
        assert _n("SELECT 1 FROM attempt_steps WHERE attempt_id=%s", item["attempt"]) == 0
        assert _n("SELECT 1 FROM jobs WHERE video_id=%s", item["video"]) == 0
        assert _n("SELECT 1 FROM pose_tracks WHERE video_id=%s", item["video"]) == 0
        assert _n("SELECT 1 FROM safety_flags WHERE video_id=%s", item["video"]) == 0
        assert not media.video_path(item["video"]).exists()
    assert not any(p.exists() for p in world["orphans"])
    # roster people with no username, and their sessions, are gone
    assert _n("SELECT 1 FROM users WHERE id=%s", world["leftover"]) == 0
    assert _n("SELECT 1 FROM sessions WHERE user_id=%s", world["leftover"]) == 0
    assert _n("SELECT 1 FROM users WHERE org_id=%s AND username IS NULL", auth.DEFAULT_ORG) == 0

    # the rest stays: agency, logins with passwords and sessions, skills, references, the Gemini log
    assert _n("SELECT 1 FROM orgs WHERE id=%s", auth.DEFAULT_ORG) == 1
    row = db.fetch_one("SELECT password_hash, notifications_seen_at FROM users WHERE id=%s", (world["login"],))
    assert row["password_hash"] == kept_before["hash"] and row["notifications_seen_at"] is None
    assert _n("SELECT 1 FROM sessions WHERE user_id=%s", world["login"]) == 1
    assert _n("SELECT 1 FROM users WHERE id=%s", world["test_nurse"]) == 1
    assert _n("SELECT 1 FROM users WHERE notifications_seen_at IS NOT NULL") == 0
    assert _n("SELECT 1 FROM skill_steps WHERE skill_id=%s", world["skill"]) == kept_before["skill_steps"] > 0
    assert _n("SELECT 1 FROM videos WHERE id=%s", world["ref"]) == 1
    assert _frames(world["ref"]) == kept_before["ref_frames"]
    assert _n("SELECT 1 FROM pose_tracks WHERE video_id=%s", world["ref"]) == kept_before["ref_tracks"]
    assert _n("SELECT 1 FROM gemini_calls") == kept_before["gemini"]
    assert media.video_path(world["ref"]).exists()

    # the login still works, and a second run has nothing left to do
    from fastapi.testclient import TestClient

    from app.main import app
    client = TestClient(app)
    client.headers["authorization"] = f"Bearer {world['token']}"
    assert client.get("/api/auth/me").status_code == 200
    again = reset_data.run(yes=True, files=True)
    assert again["files"] == 0 and again["counts"]["attempts"] == 0 and again["counts"]["orgs"] == 0
