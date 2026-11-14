"""A caregiver's graded attempt stays with them until they send it: normally from the skill's
submit_pct, "anyway" with a note from its force_pct. Only each caregiver's latest submission
per skill is in the nurse's queue, notifications and activity."""
import time

import pytest

from app import db, progress
from fixtures_agency import Agency


@pytest.fixture
def agency(migrated):
    return Agency()


def _submit(client, attempt_id, **body):
    return client.post(f"/api/attempts/{attempt_id}/submit", json=body)


def test_a_graded_attempt_waits_for_the_caregiver(agency):
    skill = agency.skill()
    cg, client = agency.caregiver()
    attempt_id = agency.attempt(cg, skill, 92)
    attempt = client.get(f"/api/attempts/{attempt_id}").json()
    assert attempt["review_state"] == "unsubmitted"
    assert (attempt["submitted_at"], attempt["submit_kind"], attempt["submit_note"]) == (None, None, "")
    assert attempt["submission"] == {
        "can_submit": True, "can_force": False, "submit_pct": 80, "force_pct": 50,
        "reason": "You scored 92%. That is good enough to send to your nurse, who asks for 80%."}
    assert attempt["policy"] == {"max_attempts": None, "submit_pct": 80, "force_pct": 50}
    assert attempt["attempts"] == {"used": 1, "allowed": None, "left": None}
    # the nurse's lists leave it out, unless she asks for everything; she can still open it
    assert agency.nurse.get("/api/attempts").json() == []
    assert [a["id"] for a in agency.nurse.get("/api/attempts?all=1").json()] == [str(attempt_id)]
    assert agency.nurse.get(f"/api/attempts/{attempt_id}").json()["review_state"] == "unsubmitted"
    res = agency.nurse.post(f"/api/attempts/{attempt_id}/review", json={"overall": "passed"})
    assert res.status_code == 409 and "has not sent this recording" in res.json()["detail"]
    mine = client.get("/api/my/skills").json()
    row = next(s for s in mine["skills"] if s["slug"] == skill["slug"])
    assert (row["state"], row["ready_attempt_id"], row["policy"]) == (
        "practicing", str(attempt_id), {"submit_pct": 80, "force_pct": 50})
    assert mine["counts"]["practicing"] == 1 and mine["counts"]["in_review"] == 0

    sent = _submit(client, attempt_id).json()
    assert (sent["review_state"], sent["submit_kind"]) == ("pending", "standard") and sent["submitted_at"]
    assert sent["submission"]["can_submit"] is False
    assert sent["submission"]["reason"] == "This recording has been sent to your nurse."
    again = _submit(client, attempt_id, force=True, note="sending twice for no reason")
    assert again.status_code == 200 and again.json()["submitted_at"] == sent["submitted_at"]
    assert again.json()["submit_kind"] == "standard" and again.json()["submit_note"] == ""
    row = next(s for s in client.get("/api/my/skills").json()["skills"] if s["slug"] == skill["slug"])
    assert (row["state"], row["attempt_id"], row["ready_attempt_id"]) == ("in_review", str(attempt_id), None)
    assert [a["id"] for a in agency.nurse.get("/api/attempts?state=pending").json()] == [str(attempt_id)]
    reviewed = agency.nurse.post(f"/api/attempts/{attempt_id}/review", json={"overall": "passed"}).json()
    assert reviewed["review_state"] == "approved"
    assert reviewed["submission"]["reason"] == "Your nurse has reviewed this recording."


def test_force_submit_needs_a_note_and_is_marked(agency):
    skill = agency.skill()
    cg, client = agency.caregiver("Dana Doe")
    attempt_id = agency.attempt(cg, skill, 64, status="failed")
    sub = client.get(f"/api/attempts/{attempt_id}").json()["submission"]
    assert (sub["can_submit"], sub["can_force"]) == (False, True)
    reason = ("You scored 64%. Your nurse asks for 80% before a recording is sent. If you think the automatic "
              "check got it wrong, you can send it anyway with a note.")
    assert sub["reason"] == reason
    res = _submit(client, attempt_id)
    assert res.status_code == 409 and res.json()["detail"] == reason
    res = _submit(client, attempt_id, force=True, note="  too short ")
    assert res.status_code == 422 and "at least 10 characters" in res.json()["detail"]
    assert client.get(f"/api/attempts/{attempt_id}").json()["review_state"] == "unsubmitted"
    note = "The camera missed my hand placement, but I did lock the brakes."
    sent = _submit(client, attempt_id, force=True, note=f"  {note} ").json()
    assert (sent["review_state"], sent["submit_kind"], sent["submit_note"]) == ("pending", "forced", note)
    listed = agency.nurse.get("/api/attempts?state=pending").json()
    assert [(a["id"], a["submit_kind"], a["submit_note"]) for a in listed] == [(str(attempt_id), "forced", note)]

    overview = agency.nurse.get("/api/overview").json()
    notification = next(n for n in overview["notifications"] if n["attempt_id"] == str(attempt_id))
    assert notification["forced"] is True and notification["kind"] == "submission"
    assert notification["title"] == "Dana Doe disagrees with the automatic check"
    assert notification["body"] == f'{skill["name"]} scored 64% and was sent anyway: "{note}"'
    event = next(e for e in overview["activity"] if e["attempt_id"] == str(attempt_id))
    assert event["forced"] is True and event["message"] == "Dana Doe disagreed with the automatic check"
    assert event["detail"] == f'Dana Doe sent {skill["name"]} for review anyway at 64%: "{note}"'
    assert event["time"] == notification["time"] == sent["submitted_at"]


@pytest.mark.parametrize("score,kwargs,expected", [
    (35, {}, "You scored 35%, which is under the 50% needed to send it."),
    (49.5, {}, "You scored 49.5%, which is under the 50% needed to send it."),
    (95, {"skill_match": False}, "The automatic check could not find this skill in the video, so it cannot be "
                                 "sent."),
    (None, {"job": "running"}, "This recording is still being checked. You can choose whether to send it once the check has finished."),
    (None, {"job": "error"}, "This recording could not be checked, so it cannot be sent."),
])
def test_attempts_that_cannot_be_sent(agency, score, kwargs, expected):
    skill = agency.skill()
    cg, client = agency.caregiver()
    attempt_id = agency.attempt(cg, skill, score, **kwargs)
    sub = client.get(f"/api/attempts/{attempt_id}").json()["submission"]
    assert (sub["can_submit"], sub["can_force"], sub["reason"]) == (False, False, expected)
    for body in ({}, {"force": True, "note": "I really think this was fine."}):
        res = _submit(client, attempt_id, **body)
        assert res.status_code == 409 and res.json()["detail"] == expected
    assert client.get(f"/api/attempts/{attempt_id}").json()["submitted_at"] is None


def test_the_nurse_sets_the_bars(agency):
    skill = agency.skill()
    cg, client = agency.caregiver()
    attempt_id = agency.attempt(cg, skill, 79.6)
    assert "You scored 79.6%." in client.get(f"/api/attempts/{attempt_id}").json()["submission"]["reason"]
    agency.nurse.put(f"/api/skills/{skill['id']}/policy", json={"submit_pct": 70, "force_pct": 30})
    sub = client.get(f"/api/attempts/{attempt_id}").json()["submission"]
    assert (sub["can_submit"], sub["submit_pct"], sub["force_pct"]) == (True, 70, 30)
    low = agency.attempt(cg, skill, 31)
    assert client.get(f"/api/attempts/{low}").json()["submission"]["can_force"] is True
    agency.nurse.put(f"/api/skills/{skill['id']}/policy", json={"submit_pct": 100, "force_pct": 100})
    assert _submit(client, attempt_id).status_code == 409
    assert _submit(client, attempt_id, force=True, note="Please look at this one.").status_code == 409


def test_who_may_send(agency):
    skill = agency.skill()
    cg, client = agency.caregiver()
    attempt_id = agency.attempt(cg, skill, 90)
    res = _submit(agency.nurse, attempt_id)
    assert res.status_code == 403 and "Only the caregiver" in res.json()["detail"]
    _, stranger = agency.caregiver("Someone Else")
    assert _submit(stranger, attempt_id).status_code == 404
    other = Agency("Other")
    _, other_cg = other.caregiver()
    assert _submit(other_cg, attempt_id).status_code == 404
    assert other.nurse.get(f"/api/attempts/{attempt_id}").status_code == 404
    assert other.nurse.get("/api/attempts?all=1").json() == []
    # a skill taken away from the caregiver cannot have recordings sent
    agency.nurse.patch(f"/api/caregivers/{cg}/skills/{skill['id']}", json={"assigned": False})
    res = _submit(client, attempt_id)
    assert res.status_code == 403 and "no longer assigned" in res.json()["detail"]
    assert client.get(f"/api/attempts/{attempt_id}").status_code == 200  # still their history


def test_a_newer_submission_supersedes_the_waiting_one(agency):
    skill = agency.skill()
    v2 = agency.skill(skill["name"], slug=skill["slug"])
    cg, client = agency.caregiver("Pat Example")
    first = agency.attempt(cg, skill, 85)
    second = agency.attempt(cg, v2, 90)
    practice = agency.attempt(cg, v2, 95)  # never sent
    other, _ = agency.caregiver("Quinn Other")
    theirs = agency.attempt(other, v2, 88, sent=True)
    _submit(client, first)
    _submit(client, second)

    def states(user_client, query=""):
        return {a["id"]: a["review_state"] for a in user_client.get(f"/api/attempts{query}").json()}

    assert states(agency.nurse) == {str(first): "superseded", str(second): "pending", str(theirs): "pending"}
    assert set(states(agency.nurse, "?state=pending")) == {str(second), str(theirs)}
    assert states(agency.nurse, "?all=1")[str(practice)] == "unsubmitted"
    assert states(agency.nurse, "?state=unsubmitted") == {}
    assert set(states(client)) == {str(first), str(second), str(practice)}  # a caregiver sees all their own
    assert client.get(f"/api/attempts/{first}").json()["submission"]["reason"] == (
        "You sent a newer recording of this skill, so your nurse will review that one instead.")

    # history: the caregiver's other attempts at the slug, across versions, newest first
    detail = agency.nurse.get(f"/api/attempts/{second}").json()
    assert [h["id"] for h in detail["history"]] == [str(practice), str(first)]
    assert set(detail["history"][0]) == {"id", "created_at", "submitted_at", "submit_kind", "score_pct", "status",
                                         "final_status", "review_state", "skill_id", "skill_version"}
    assert detail["attempts"] == {"used": 3, "allowed": None, "left": None}

    # the nurse's pages count the latest submission only
    overview = agency.nurse.get("/api/overview").json()
    assert overview["counts"]["pending"] == 2
    assert {n["attempt_id"] for n in overview["notifications"]} == {str(second), str(theirs)}
    assert str(first) not in {e["attempt_id"] for e in overview["activity"]}
    assert str(practice) not in {e["attempt_id"] for e in overview["activity"]}
    roster = {p["id"]: p for p in agency.nurse.get("/api/caregivers").json()}
    assert roster[str(cg)]["pending_attempt_id"] == str(second)
    assert roster[str(cg)]["attempt_count"] == 3
    assert roster[str(cg)]["last_submission_at"] == detail["submitted_at"]
    cg_detail = agency.nurse.get(f"/api/caregivers/{cg}").json()
    assert {a["id"]: a["review_state"] for a in cg_detail["attempts"]} == {
        str(first): "superseded", str(second): "pending", str(practice): "unsubmitted"}
    standing = next(s for s in cg_detail["skills"] if s["slug"] == skill["slug"])
    assert (standing["state"], standing["attempt_id"], standing["attempts_used"]) == ("in_review", str(second), 3)

    # a superseded submission can still be decided on; the latest one stays in the queue
    agency.nurse.post(f"/api/attempts/{first}/review", json={"overall": "failed", "note": "Old one"})
    assert states(agency.nurse, "?state=pending") == {str(second): "pending", str(theirs): "pending"}
    mine = next(s for s in client.get("/api/my/skills").json()["skills"] if s["slug"] == skill["slug"])
    assert mine["state"] == "in_review" and mine["attempt_id"] == str(second)
    # sending the old practice run now replaces the second one
    _submit(client, practice)
    assert states(agency.nurse, "?state=pending") == {str(practice): "pending", str(theirs): "pending"}
    assert states(agency.nurse)[str(second)] == "superseded"


def test_ready_attempt_is_the_best_sendable_one_since_the_last_decision(agency):
    skill = agency.skill()
    cg, client = agency.caregiver()

    def mine():
        return next(s for s in client.get("/api/my/skills").json()["skills"] if s["slug"] == skill["slug"])

    assert (mine()["state"], mine()["ready_attempt_id"]) == ("not_started", None)
    agency.attempt(cg, skill, 60)
    assert (mine()["state"], mine()["ready_attempt_id"]) == ("practicing", None)
    good = agency.attempt(cg, skill, 84)
    best = agency.attempt(cg, skill, 97)
    agency.attempt(cg, skill, 99, skill_match=False)
    assert mine()["ready_attempt_id"] == str(best)
    _submit(client, good)
    agency.nurse.post(f"/api/attempts/{good}/review", json={"overall": "failed"})
    assert (mine()["state"], mine()["ready_attempt_id"]) == ("needs_practice", None)  # best is from before
    again = agency.attempt(cg, skill, 81)
    assert (mine()["state"], mine()["ready_attempt_id"]) == ("practicing", str(again))
    _submit(client, again)
    agency.nurse.post(f"/api/attempts/{again}/review", json={"overall": "passed"})
    assert (mine()["state"], mine()["ready_attempt_id"]) == ("verified", None)


def test_overview_is_built_from_submissions(agency):
    skill = agency.skill()
    cg, client = agency.caregiver("Robin Roe")
    practice = agency.attempt(cg, skill, 95, status="failed", flags=1)  # a safety concern, not sent yet
    agency.attempt(cg, skill, None, job="running")           # the caregiver's practice, processing
    nurse_upload = agency.attempt(None, skill, None, job="running")  # a nurse's own upload, processing
    overview = agency.nurse.get("/api/overview").json()
    assert overview["counts"]["pending"] == 0 and overview["counts"]["safety_flags"] == 0
    assert overview["counts"]["processing"] == 1
    assert overview["activity"] == [] and overview["flagged_skills"] == []
    assert [n for n in overview["notifications"] if n["kind"] != "digest"] == []
    assert agency.nurse.get("/api/attempts?state=processing").json()[0]["id"] == str(nurse_upload)

    time.sleep(0.05)
    sent = _submit(client, practice).json()
    overview = agency.nurse.get("/api/overview").json()
    assert overview["counts"]["pending"] == 1 and overview["counts"]["safety_flags"] == 1
    assert [f["slug"] for f in overview["flagged_skills"]] == [skill["slug"]]
    events = [e for e in overview["activity"] if e["attempt_id"] == str(practice)]
    assert [e["type"] for e in events] == ["safety"] and events[0]["forced"] is False
    notification = next(n for n in overview["notifications"] if n["attempt_id"] == str(practice))
    assert notification["kind"] == "safety"
    # event times are when it was sent, not when it was recorded
    attempt = agency.nurse.get(f"/api/attempts/{practice}").json()
    assert attempt["submitted_at"] == sent["submitted_at"] and attempt["submitted_at"] > attempt["created_at"]
    assert events[0]["time"] == attempt["submitted_at"] and notification["time"] == attempt["submitted_at"]
    roster = next(p for p in agency.nurse.get("/api/caregivers").json() if p["id"] == str(cg))
    assert roster["status"] == "restricted" and roster["open_flags"] == 1


def test_first_submission_and_decisions_in_activity(agency):
    skill = agency.skill()
    cg, client = agency.caregiver("Sky Example")
    agency.attempt(cg, skill, 90)  # practice first: not an assessment yet
    first = agency.attempt(cg, skill, 91)
    _submit(client, first)
    activity = agency.nurse.get("/api/overview").json()["activity"]
    assert [(e["type"], e["attempt_id"]) for e in activity] == [("first_assessment", str(first))]
    agency.nurse.post(f"/api/attempts/{first}/review", json={"overall": "failed"})
    second = agency.attempt(cg, skill, 93)
    _submit(client, second)
    activity = agency.nurse.get("/api/overview").json()["activity"]
    assert [(e["type"], e["attempt_id"]) for e in activity] == [
        ("submission", str(second)), ("retraining", str(first)), ("first_assessment", str(first))]
    assert activity[0]["detail"] == f"{skill['name']} is waiting for nurse review."


def test_skill_list_counts_submissions(agency):
    skill = agency.skill()
    cg, client = agency.caregiver()
    agency.attempt(cg, skill, 40)
    sent = agency.attempt(cg, skill, 90)
    _submit(client, sent)
    agency.attempt(None, skill, 70)  # a nurse's upload counts as sent
    row = next(s for s in agency.nurse.get("/api/skills").json() if s["id"] == str(skill["id"]))
    assert (row["attempt_count"], row["submission_count"]) == (3, 2)


def test_a_nurse_upload_is_sent_when_created(agency):
    skill = agency.skill()
    attempt_id = agency.attempt(None, skill, 20, status="failed")
    attempt = agency.nurse.get(f"/api/attempts/{attempt_id}").json()
    assert attempt["review_state"] == "pending" and attempt["submit_kind"] == "standard"
    assert attempt["attempts"] == {"used": None, "allowed": None, "left": None} and attempt["history"] == []
    assert agency.nurse.post(f"/api/attempts/{attempt_id}/review", json={"overall": "passed"}).status_code == 200


def test_a_recorded_attempt_through_the_pipeline_is_not_sent_until_the_caregiver_sends_it(agency, sample_video):
    skill = agency.skill()
    agency.nurse.put(f"/api/skills/{skill['id']}/policy", json={"max_attempts": 2})
    cg, client = agency.caregiver()
    with sample_video.open("rb") as file:
        res = client.post("/api/videos", data={"kind": "attempt", "skill_id": str(skill["id"])},
                          files={"file": ("attempt.mp4", file, "video/mp4")})
    assert res.status_code == 200, res.text
    body = res.json()
    for _ in range(600):
        if client.get(f"/api/jobs/{body['job_id']}").json()["status"] in ("done", "error"):
            break
        time.sleep(0.2)
    attempt = client.get(f"/api/attempts/{body['attempt_id']}").json()
    assert attempt["job"]["status"] == "done" and attempt["review_state"] == "unsubmitted"
    assert attempt["attempts"] == {"used": 1, "allowed": 2, "left": 1}
    assert agency.nurse.get("/api/attempts").json() == []
    assert agency.nurse.get("/api/overview").json()["counts"]["pending"] == 0
    # whatever the canned grade was, a score over the bar can be sent
    db.execute("UPDATE attempts SET score_pct=88, skill_match=true WHERE id=%s", (body["attempt_id"],))
    # at or above the bar it is still not sent: it waits, and the nurse sees nothing, until the caregiver presses send
    graded = client.get(f"/api/attempts/{body['attempt_id']}").json()
    assert graded["submission"]["can_submit"] and graded["review_state"] == "unsubmitted"
    assert graded["submitted_at"] is None
    assert agency.nurse.get("/api/attempts?state=pending").json() == []
    assert _submit(client, body["attempt_id"]).json()["review_state"] == "pending"
    assert [a["id"] for a in agency.nurse.get("/api/attempts?state=pending").json()] == [body["attempt_id"]]


def test_skill_states_unit():
    import datetime as dt

    t0 = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)

    def row(n, *, sent=None, reviewed=None, nurse=None, job="done", status="passed", newer=False):
        r = {"id": f"a{n}", "created_at": t0 + dt.timedelta(days=n), "status": status, "nurse_status": nurse,
             "job_status": job, "submitted_at": t0 + dt.timedelta(days=sent) if sent is not None else None,
             "reviewed_at": t0 + dt.timedelta(days=reviewed) if reviewed is not None else None,
             "newer_submission": newer, "flag_count": 0}
        return progress.describe(r)

    assert progress.skill_state([row(1)])["state"] == "practicing"
    assert progress.skill_state([row(1, job="running", status=None)])["state"] == "practicing"
    assert progress.skill_state([row(1, job="error", status=None)])["state"] == "not_started"
    assert progress.skill_state([row(1, sent=1)])["state"] == "in_review"
    retrain = row(1, sent=1, reviewed=2, nurse="failed")
    assert progress.skill_state([retrain])["state"] == "needs_practice"
    assert progress.skill_state([retrain, row(3)])["state"] == "practicing"
    assert progress.skill_state([retrain, row(3, sent=4)])["state"] == "in_review"
    assert row(1, sent=1, newer=True)["review_state"] == "superseded"
    assert progress.attempts_used([row(1), retrain, row(3), row(4, job="error", status=None)]) == 1
