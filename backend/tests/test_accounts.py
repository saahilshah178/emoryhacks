"""Accounts, roles, agency separation and the states derived from attempts."""
import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient

from app import auth, db, jobs, progress, repo
from app.main import app


def _anonymous() -> TestClient:
    client = TestClient(app)
    client.headers.pop("authorization", None)
    return client


def _signup(role: str, name: str = "Pat Example") -> tuple[TestClient, dict]:
    client = _anonymous()
    res = client.post("/api/auth/signup", json={"role": role, "name": name,
                                                "email": f"{uuid.uuid4().hex[:10]}@example.test",
                                                "password": "long-enough"})
    assert res.status_code == 200, res.text
    return client, res.json()


def _client_in_new_org(role: str = "nurse") -> TestClient:
    """A signed-in user of an agency other than the default one."""
    org_id = uuid.uuid4()
    db.execute("INSERT INTO orgs (id, name) VALUES (%s, %s)", (org_id, "Other agency"))
    user_id = auth.create_user(org_id=org_id, role=role, name="Other Person",
                               email=f"{uuid.uuid4().hex[:10]}@other.test", password="long-enough")
    client = _anonymous()
    client.headers["authorization"] = f"Bearer {auth.create_session(user_id)}"
    return client


@pytest.fixture(scope="module")
def graded(migrated, sample_video):
    """A skill of the default agency and one attempt at it by a caregiver account, graded with canned AI."""
    caregiver_client, caregiver = _signup("caregiver", "Casey Caregiver")
    ref = jobs.ingest(str(sample_video), "reference", sample_video.name)
    job_id = repo.create_job("reference", ref["id"])
    jobs.run_reference(job_id, slug=f"accounts_{uuid.uuid4().hex[:6]}", name="Accounts test skill")
    skill_id = repo.get_job(job_id)["skill_id"]
    with sample_video.open("rb") as file:
        res = caregiver_client.post("/api/videos", data={"kind": "attempt", "skill_id": str(skill_id),
                                                         "caregiver_name": "Someone Else"},
                                    files={"file": ("attempt.mp4", file, "video/mp4")})
    assert res.status_code == 200, res.text
    body = res.json()
    for _ in range(600):
        job = caregiver_client.get(f"/api/jobs/{body['job_id']}").json()
        if job["status"] in ("done", "error"):
            break
        import time
        time.sleep(0.2)
    assert job["status"] == "done", job
    return {"skill_id": str(skill_id), "attempt_id": body["attempt_id"], "video_id": body["video_id"],
            "caregiver": caregiver, "caregiver_client": caregiver_client}


def test_passwords_are_hashed_and_verified():
    stored = auth.hash_password("correct horse")
    assert "correct horse" not in stored
    assert auth.verify_password("correct horse", stored)
    assert not auth.verify_password("wrong", stored)
    assert not auth.verify_password("anything", None)
    assert not auth.verify_password("anything", "not-a-hash")


def test_signup_login_logout(migrated):
    client, user = _signup("nurse")
    assert user["role"] == "nurse" and user["org"]["id"] == str(auth.DEFAULT_ORG) and "password" not in str(user)
    assert client.get("/api/auth/me").json()["email"] == user["email"]
    assert client.get("/api/auth/session").json()["user"]["id"] == user["id"]
    # the session lives in an HttpOnly cookie
    assert "httponly" in client.post("/api/auth/login", json={"email": user["email"],
                                                              "password": "long-enough"}).headers["set-cookie"].lower()
    assert client.post("/api/auth/logout").json() == {"ok": True}
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/session").json() == {"user": None}

    again = _anonymous()
    assert again.post("/api/auth/login", json={"email": user["email"], "password": "nope-nope"}).status_code == 401
    assert again.post("/api/auth/login", json={"email": "nobody@example.test", "password": "x"}).status_code == 401
    assert again.post("/api/auth/login", json={"email": user["email"].upper(), "password": "long-enough"}).status_code == 200


def test_signup_validation(migrated):
    client, user = _signup("caregiver")
    fresh = _anonymous()
    base = {"role": "caregiver", "name": "New Person", "email": "new.person@example.test", "password": "long-enough"}
    assert fresh.post("/api/auth/signup", json={**base, "email": user["email"]}).status_code == 409
    assert fresh.post("/api/auth/signup", json={**base, "password": "short"}).status_code == 422
    assert fresh.post("/api/auth/signup", json={**base, "email": "not-an-email"}).status_code == 422
    assert fresh.post("/api/auth/signup", json={**base, "role": "admin"}).status_code == 422
    assert fresh.post("/api/auth/signup", json={**base, "name": " "}).status_code == 422


def test_everything_needs_a_session(migrated):
    client = _anonymous()
    for path in ("/api/skills", "/api/attempts", "/api/caregivers", "/api/overview", "/api/my/skills",
                 "/api/safety/overview", "/api/jobs", f"/api/videos/{uuid.uuid4()}/file"):
        assert client.get(path).status_code == 401, path
    assert client.get("/api/health").status_code == 200


def test_profile_and_agency_edits(migrated):
    client, user = _signup("nurse")
    patched = client.patch("/api/auth/me", json={"name": "Renamed Nurse", "credentials": "RN",
                                                 "prefs": {"digest": True}}).json()
    assert patched["name"] == "Renamed Nurse" and patched["credentials"] == "RN"
    assert patched["prefs"] == {"safety": True, "submissions": True, "digest": True}
    assert client.get("/api/auth/me").json()["name"] == "Renamed Nurse"  # not a stale cached copy
    assert client.patch("/api/auth/me", json={"name": "x"}).status_code == 422

    other = _client_in_new_org("nurse")
    assert other.patch("/api/org", json={"name": "Renamed agency"}).json()["org"]["name"] == "Renamed agency"
    caregiver, _ = _signup("caregiver")
    assert caregiver.patch("/api/org", json={"name": "Nope"}).status_code == 403


def test_changing_a_password_needs_the_current_one(migrated):
    client, user = _signup("caregiver")
    login = {"email": user["email"], "password": "long-enough"}
    # A second device signed in to the same account.
    other = _anonymous()
    assert other.post("/api/auth/login", json=login).status_code == 200

    wrong = client.post("/api/auth/password", json={"current_password": "not-my-password", "new_password": "a-new-password"})
    assert wrong.status_code == 400 and "current password" in wrong.json()["detail"]
    short = client.post("/api/auth/password", json={"current_password": "long-enough", "new_password": "short"})
    assert short.status_code == 422 and "at least 8" in short.json()["detail"]
    same = client.post("/api/auth/password", json={"current_password": "long-enough", "new_password": "long-enough"})
    assert same.status_code == 422 and "different" in same.json()["detail"]
    # None of those changed anything.
    assert _anonymous().post("/api/auth/login", json=login).status_code == 200
    assert other.get("/api/auth/me").status_code == 200

    done = client.post("/api/auth/password", json={"current_password": "long-enough", "new_password": "a-new-password"})
    assert done.status_code == 200 and done.json() == {"ok": True}
    # The old password no longer works, the new one does.
    assert _anonymous().post("/api/auth/login", json=login).status_code == 401
    assert _anonymous().post("/api/auth/login", json={**login, "password": "a-new-password"}).status_code == 200
    # The session that changed it stays signed in; the other device is signed out.
    assert client.get("/api/auth/me").json()["email"] == user["email"]
    assert other.get("/api/auth/me").status_code == 401
    # Only the scrypt hash is stored.
    stored = db.fetch_one("SELECT password_hash FROM users WHERE id=%s", (user["id"],))["password_hash"]
    assert stored.startswith("scrypt$") and "a-new-password" not in stored


def test_changing_a_password_needs_a_session_and_touches_no_one_else(migrated):
    assert _anonymous().post("/api/auth/password", json={"current_password": "x", "new_password": "a-new-password"}).status_code == 401
    one, first = _signup("caregiver")
    two, second = _signup("nurse")
    assert one.post("/api/auth/password", json={"current_password": "long-enough", "new_password": "only-mine-changed"}).status_code == 200
    # The other account keeps its password and its session.
    assert _anonymous().post("/api/auth/login", json={"email": second["email"], "password": "long-enough"}).status_code == 200
    assert two.get("/api/auth/me").json()["email"] == second["email"]


def test_caregiver_attempt_is_filed_under_their_account(graded):
    attempt = graded["caregiver_client"].get(f"/api/attempts/{graded['attempt_id']}").json()
    assert attempt["caregiver_id"] == graded["caregiver"]["id"]
    assert attempt["caregiver_name"] == "Casey Caregiver"  # not the name sent with the upload
    assert attempt["review_state"] == "pending"
    assert attempt["ai_assessment"] in ("passed", "needs_review", "not_passed", "safety_concern")
    assert attempt["video"]["available"] is True
    assert "path" not in attempt["video"] and "gemini_file_uri" not in attempt["video"]


def test_roles(graded):
    caregiver = graded["caregiver_client"]
    for path in ("/api/caregivers", "/api/overview", "/api/safety/overview", "/api/safety/trends", "/api/jobs",
                 f"/api/safety/videos/{graded['video_id']}/summary"):
        assert caregiver.get(path).status_code == 403, path
    assert caregiver.patch(f"/api/skills/{graded['skill_id']}", json={"name": "Hacked"}).status_code == 403
    assert caregiver.patch(f"/api/skills/{graded['skill_id']}/steps/s1", json={"title": "x"}).status_code == 403
    assert caregiver.post(f"/api/skills/{graded['skill_id']}/regenerate").status_code == 403
    assert caregiver.delete(f"/api/skills/{graded['skill_id']}").status_code == 403
    assert caregiver.post(f"/api/attempts/{graded['attempt_id']}/review", json={"overall": "passed"}).status_code == 403
    assert caregiver.post("/api/videos", data={"kind": "reference"},
                          files={"file": ("x.mp4", b"abc", "video/mp4")}).status_code == 403
    # what a caregiver may do: read skills, their own attempts, and the videos behind them
    assert caregiver.get(f"/api/skills/{graded['skill_id']}").status_code == 200
    assert caregiver.get(f"/api/videos/{graded['video_id']}/file", headers={"Range": "bytes=0-9"}).status_code == 206
    nurse = TestClient(app)
    assert nurse.get("/api/my/skills").status_code == 403


def test_a_caregiver_sees_only_their_own_attempts(graded):
    other, _ = _signup("caregiver", "Other Caregiver")
    assert other.get(f"/api/attempts/{graded['attempt_id']}").status_code == 404
    assert other.get(f"/api/videos/{graded['video_id']}/file").status_code == 404
    assert other.get("/api/attempts").json() == []
    mine = graded["caregiver_client"].get("/api/attempts").json()
    assert [a["id"] for a in mine] == [graded["attempt_id"]]
    # asking for someone else's attempts by id still returns only your own
    assert other.get(f"/api/attempts?caregiver_id={graded['caregiver']['id']}").json() == []


def test_agencies_do_not_see_each_other(graded):
    other = _client_in_new_org("nurse")
    assert other.get("/api/skills").json() == []
    assert other.get("/api/attempts").json() == []
    assert other.get("/api/caregivers").json() == []
    assert other.get("/api/safety/overview").json() == []
    for path in (f"/api/skills/{graded['skill_id']}", f"/api/attempts/{graded['attempt_id']}",
                 f"/api/videos/{graded['video_id']}", f"/api/videos/{graded['video_id']}/file",
                 f"/api/safety/videos/{graded['video_id']}/series", f"/api/caregivers/{graded['caregiver']['id']}"):
        assert other.get(path).status_code == 404, path
    assert other.patch(f"/api/skills/{graded['skill_id']}", json={"name": "x"}).status_code == 404
    assert other.delete(f"/api/skills/{graded['skill_id']}").status_code == 404
    assert other.post(f"/api/attempts/{graded['attempt_id']}/review", json={"overall": "passed"}).status_code == 404
    overview = other.get("/api/overview").json()
    assert overview["counts"]["pending"] == 0 and overview["activity"] == []


def test_skill_versions_are_numbered_per_agency(migrated, sample_video):
    slug = f"shared_{uuid.uuid4().hex[:6]}"
    org_id = uuid.uuid4()
    db.execute("INSERT INTO orgs (id, name) VALUES (%s, %s)", (org_id, "Second agency"))
    ids = []
    for org in (None, org_id):
        ref = jobs.ingest(str(sample_video), "reference", sample_video.name, org)
        job_id = repo.create_job("reference", ref["id"])
        jobs.run_reference(job_id, slug=slug, name="Shared name")
        ids.append(repo.get_job(job_id)["skill_id"])
    first, second = (repo.get_skill(i) for i in ids)
    assert first["version"] == second["version"] == 1
    assert first["org_id"] == auth.DEFAULT_ORG and second["org_id"] == org_id
    assert first["latest_id"] == first["id"] and second["latest_id"] == second["id"]


def test_review_drives_roster_and_caregiver_progress(graded):
    nurse = TestClient(app)
    caregiver = graded["caregiver_client"]
    person_id = graded["caregiver"]["id"]

    def standing():
        skills = caregiver.get("/api/my/skills").json()["skills"]
        return next(s for s in skills if s["id"] == graded["skill_id"])

    assert standing()["state"] == "in_review"
    row = next(p for p in nurse.get("/api/caregivers").json() if p["id"] == person_id)
    assert row["pending_attempt_id"] == graded["attempt_id"] and row["skills_verified"] == 0
    assert any(n["attempt_id"] == graded["attempt_id"] for n in nurse.get("/api/overview").json()["notifications"])

    reviewed = nurse.post(f"/api/attempts/{graded['attempt_id']}/review",
                          json={"overall": "failed", "note": "Practise the pivot."}).json()
    assert reviewed["review_state"] == "retraining" and reviewed["reviewer_name"] == "Test Nurse"
    assert standing()["state"] == "needs_practice"
    assert nurse.get("/api/attempts?state=pending&caregiver_id=" + person_id).json() == []

    approved = nurse.post(f"/api/attempts/{graded['attempt_id']}/review", json={"overall": "passed", "note": "Good."}).json()
    assert approved["review_state"] == "approved" and approved["final_status"] == "passed"
    assert standing()["state"] == "verified" and standing()["attempt_id"] == graded["attempt_id"]
    detail = nurse.get(f"/api/caregivers/{person_id}").json()
    assert detail["skills_verified"] == 1 and detail["pending_attempt_id"] is None
    assert [a["id"] for a in detail["attempts"]] == [graded["attempt_id"]]
    assert next(s for s in detail["skills"] if s["skill_id"] == graded["skill_id"])["state"] == "verified"
    activity = nurse.get("/api/overview").json()["activity"]
    assert any(e["type"] == "approval" and e["attempt_id"] == graded["attempt_id"] for e in activity)

    assert nurse.patch(f"/api/caregivers/{person_id}", json={"employment": "active"}).json()["status"] == "active"
    assert nurse.patch(f"/api/caregivers/{person_id}", json={"employment": "retired"}).status_code == 422


def test_notifications_can_be_marked_seen(graded):
    nurse, _ = _signup("nurse")
    assert nurse.post("/api/notifications/seen").json() == {"ok": True}
    assert nurse.get("/api/overview").json()["unread"] == 0


def test_caregiver_guide_falls_back_to_the_rubric_and_can_be_overridden(graded):
    nurse = TestClient(app)
    skill = nurse.get(f"/api/skills/{graded['skill_id']}").json()
    assert skill["guide"]["estimated_minutes"] >= 1
    assert [c["message"] for c in skill["guide"]["cues"]] == [s["title"] for s in skill["steps"]]
    patched = nurse.patch(f"/api/skills/{graded['skill_id']}",
                          json={"guide": {"description": "Short blurb", "safety_reminder": "Lock the brakes."}}).json()
    assert patched["guide"]["description"] == "Short blurb" and patched["guide"]["safety_reminder"] == "Lock the brakes."
    cleared = nurse.patch(f"/api/skills/{graded['skill_id']}", json={"guide": {"description": ""}}).json()
    assert cleared["guide"]["description"] != "Short blurb" and cleared["guide"]["safety_reminder"] == "Lock the brakes."


# --- derived states (app/progress.py) ---------------------------------------------------------
def _attempt(n: int, *, status="passed", nurse=None, reviewed=False, job="done", flags=0) -> dict:
    created = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc) + dt.timedelta(days=n)
    row = {"id": f"a{n}", "created_at": created, "status": status, "nurse_status": nurse, "job_status": job,
           "reviewed_at": created + dt.timedelta(hours=1) if reviewed else None, "flag_count": flags}
    return progress.describe(row)


@pytest.mark.parametrize("kwargs,expected", [
    ({"status": None, "job": "running"}, ("processing", None)),
    ({"status": None, "job": "error"}, ("error", None)),
    ({"status": None, "job": None}, ("error", None)),
    ({"status": "passed"}, ("pending", "passed")),
    ({"status": "passed", "job": None}, ("pending", "passed")),  # sample data has no job rows
    ({"status": "unverified", "flags": 1}, ("pending", "needs_review")),
    ({"status": "failed"}, ("pending", "not_passed")),
    ({"status": "failed", "flags": 2}, ("pending", "safety_concern")),
    ({"status": "failed", "nurse": "passed", "reviewed": True}, ("approved", "not_passed")),
    ({"status": "passed", "nurse": "failed", "reviewed": True}, ("retraining", "passed")),
    ({"status": "passed", "nurse": "unverified", "reviewed": True}, ("retraining", "passed")),
    ({"status": "passed", "reviewed": True}, ("approved", "passed")),  # a note without a changed result
])
def test_attempt_states(kwargs, expected):
    row = _attempt(1, **kwargs)
    assert (row["review_state"], row["ai_assessment"]) == expected


def test_skill_state_follows_the_nurses_last_decision():
    assert progress.skill_state([])["state"] == "not_started"
    assert progress.skill_state([_attempt(1, status=None, job="error")])["state"] == "not_started"
    assert progress.skill_state([_attempt(1)]) == {"state": "in_review", "attempt_id": "a1",
                                                   "latest_attempt_id": "a1", "attempts": 1}
    retrain = _attempt(1, nurse="failed", reviewed=True)
    assert progress.skill_state([retrain])["state"] == "needs_practice"
    assert progress.skill_state([retrain, _attempt(2)]) == {"state": "in_review", "attempt_id": "a2",
                                                            "latest_attempt_id": "a2", "attempts": 2}
    approved = _attempt(3, nurse="passed", reviewed=True)
    assert progress.skill_state([retrain, approved])["state"] == "verified"
    # practising again after an approval does not take the verification away
    again = progress.skill_state([retrain, approved, _attempt(4)])
    assert again["state"] == "verified" and again["attempt_id"] == "a3" and again["latest_attempt_id"] == "a4"
    # a later retraining decision does
    assert progress.skill_state([approved, _attempt(5, nurse="failed", reviewed=True)])["state"] == "needs_practice"


def test_sample_agency_seed(migrated, monkeypatch):
    """The sample agency loads, passes its own checks, and its nurse sees it through the API."""
    from scripts import seed_sample

    monkeypatch.setenv("SAMPLE_PASSWORD", "sample-test-pass")
    assert seed_sample.main() == 0
    assert seed_sample.main() == 0  # a re-seed replaces it cleanly
    client = _anonymous()
    user = client.post("/api/auth/login", json={"email": "p.chen@harborhomecare.example",
                                                "password": "sample-test-pass"}).json()
    assert user["org"] == {"id": str(auth.SAMPLE_ORG), "name": "Harbor Home Care", "is_sample": True}
    overview = client.get("/api/overview").json()
    assert overview["counts"]["caregivers"] == 13 and overview["counts"]["pending"] == 8
    assert overview["missed_steps"][0]["count"] == 11
    pending = client.get("/api/attempts?state=pending").json()
    attempt = client.get(f"/api/attempts/{pending[0]['id']}").json()
    assert attempt["video"]["available"] is False and attempt["steps"]
    # the default agency does not see the sample data
    assert not any(s["org_id"] == str(auth.SAMPLE_ORG) for s in TestClient(app).get("/api/skills").json())


def test_a_step_without_times_can_still_be_edited(graded):
    """Steps written by hand (the sample agency's) have start = end = 0."""
    nurse = TestClient(app)
    db.execute("UPDATE skill_steps SET start_s=0, end_s=0 WHERE skill_id=%s AND step_id='s1'", (graded["skill_id"],))
    edited = nurse.patch(f"/api/skills/{graded['skill_id']}/steps/s1", json={"title": "Untimed but edited"})
    assert edited.status_code == 200 and edited.json()["steps"][0]["title"] == "Untimed but edited"
    assert nurse.patch(f"/api/skills/{graded['skill_id']}/steps/s1", json={"end_s": 0}).status_code == 422
    timed = nurse.patch(f"/api/skills/{graded['skill_id']}/steps/s1", json={"start_s": 1, "end_s": 4}).json()
    assert (timed["steps"][0]["start_s"], timed["steps"][0]["end_s"]) == (1, 4)
