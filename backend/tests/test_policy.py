"""A nurse's rules for a skill: attempts allowed, per-caregiver limits and grants, a fresh set
after retraining, and which caregivers the skill is assigned to."""
import uuid

import pytest

from app import db, progress
from fixtures_agency import Agency, upload


@pytest.fixture
def agency(migrated):
    return Agency()


def _row(policy: dict, caregiver_id) -> dict:
    return next(c for c in policy["caregivers"] if c["id"] == str(caregiver_id))


def test_defaults_are_unlimited_and_assigned_to_everyone(agency):
    skill = agency.skill()
    cg, _ = agency.caregiver()
    policy = agency.nurse.get(f"/api/skills/{skill['id']}/policy").json()
    assert {k: policy[k] for k in ("slug", "max_attempts", "submit_pct", "force_pct", "assign_all")} == {
        "slug": skill["slug"], "max_attempts": None, "submit_pct": 80, "force_pct": 50, "assign_all": True}
    assert _row(policy, cg) == {"id": str(cg), "name": "Casey Caregiver", "title": "caregiver title", "assigned": True,
                                "limit_mode": "inherit", "max_attempts": None, "attempts_used": 0,
                                "attempts_allowed": None, "attempts_left": None, "state": "not_started",
                                "skill_attempt_limit": None}
    listed = next(s for s in agency.nurse.get("/api/skills").json() if s["id"] == str(skill["id"]))
    assert listed["policy"] == {"max_attempts": None, "submit_pct": 80, "force_pct": 50, "assign_all": True,
                                "assigned_count": 1}
    assert listed["submission_count"] == 0
    assert agency.nurse.get(f"/api/skills/{skill['id']}").json()["policy"]["max_attempts"] is None


def test_policy_validation_is_readable(agency):
    skill = agency.skill()
    url = f"/api/skills/{skill['id']}/policy"
    for body, words in [({"max_attempts": 0}, "1 to 50"), ({"max_attempts": 51}, "1 to 50"),
                        ({"submit_pct": 101}, "between 0% and 100%"), ({"submit_pct": -1}, "between 0% and 100%"),
                        ({"submit_pct": 60, "force_pct": 70}, "send it normally"),
                        ({"force_pct": -5}, "send it normally"),
                        ({"assign_all": False, "assigned_ids": [str(uuid.uuid4())]}, "not caregivers in this agency")]:
        res = agency.nurse.put(url, json=body)
        assert res.status_code == 422 and words in res.json()["detail"], (body, res.text)
    # a nurse of the same agency is not a caregiver to assign
    res = agency.nurse.put(url, json={"assign_all": False, "assigned_ids": [str(agency.nurse_id)]})
    assert res.status_code == 422
    # nothing was saved
    assert agency.nurse.get(url).json()["submit_pct"] == 80
    caregiver = agency.caregiver()[1]
    assert caregiver.get(url).status_code == 403 and caregiver.put(url, json={}).status_code == 403


def test_policy_update_keeps_fields_left_out_and_carries_over_to_new_versions(agency):
    skill = agency.skill()
    url = f"/api/skills/{skill['id']}/policy"
    saved = agency.nurse.put(url, json={"max_attempts": 3, "submit_pct": 90, "force_pct": 40}).json()
    assert (saved["max_attempts"], saved["submit_pct"], saved["force_pct"], saved["assign_all"]) == (3, 90, 40, True)
    assert agency.nurse.put(url, json={"submit_pct": 85}).json()["max_attempts"] == 3
    assert agency.nurse.put(url, json={"max_attempts": None}).json()["max_attempts"] is None  # null is unlimited
    assert agency.nurse.put(url, json={"max_attempts": 2}).json()["max_attempts"] == 2
    v2 = agency.skill(skill["name"], slug=skill["slug"])
    again = agency.nurse.get(f"/api/skills/{v2['id']}/policy").json()
    assert (again["max_attempts"], again["submit_pct"], again["force_pct"]) == (2, 85, 40)


def test_a_limited_skill_refuses_the_next_upload_with_a_sentence(agency):
    skill = agency.skill()
    cg, client = agency.caregiver()
    agency.nurse.put(f"/api/skills/{skill['id']}/policy", json={"max_attempts": 3})
    for _ in range(3):
        agency.attempt(cg, skill, 60)
    res = upload(client, skill["id"])
    assert res.status_code == 409
    assert res.json()["detail"] == "You have used all 3 attempts for this skill. Ask your nurse for more."
    # one attempt allowed reads naturally too
    agency.nurse.put(f"/api/skills/{skill['id']}/policy", json={"max_attempts": 1})
    assert upload(client, skill["id"]).json()["detail"] == (
        "You have used your only attempt for this skill. Ask your nurse for more.")
    # a nurse is never limited: her upload gets as far as reading the file
    assert upload(agency.nurse, skill["id"]).status_code == 422


def test_attempts_used_counts_every_version_but_not_failed_processing(agency):
    skill = agency.skill()
    v2 = agency.skill(skill["name"], slug=skill["slug"])
    cg, client = agency.caregiver()
    agency.nurse.put(f"/api/skills/{skill['id']}/policy", json={"max_attempts": 3})
    agency.attempt(cg, skill, 40)              # version 1, not sent
    agency.attempt(cg, v2, 90, sent=True)      # version 2, sent
    agency.attempt(cg, v2, None, job="error")  # failed processing: does not count
    agency.attempt(cg, v2, None, job="running")  # still processing: counts
    row = _row(agency.nurse.get(f"/api/skills/{v2['id']}/policy").json(), cg)
    assert (row["attempts_used"], row["attempts_allowed"], row["attempts_left"]) == (3, 3, 0)
    assert upload(client, v2["id"]).status_code == 409
    # another caregiver has their own count
    other, other_client = agency.caregiver("Other Caregiver")
    assert upload(other_client, v2["id"]).status_code == 422  # allowed: it reached the file


def test_retraining_starts_a_fresh_set_of_attempts(agency):
    skill = agency.skill()
    cg, client = agency.caregiver()
    agency.nurse.put(f"/api/skills/{skill['id']}/policy", json={"max_attempts": 2})
    agency.attempt(cg, skill, 40)
    sent = agency.attempt(cg, skill, 85, sent=True)
    assert upload(client, skill["id"]).status_code == 409
    agency.nurse.post(f"/api/attempts/{sent}/review", json={"overall": "failed", "note": "Again"})
    mine = next(s for s in client.get("/api/my/skills").json()["skills"] if s["slug"] == skill["slug"])
    assert (mine["attempts_used"], mine["attempts_allowed"], mine["attempts_left"]) == (0, 2, 2)
    assert mine["state"] == "needs_practice"
    agency.attempt(cg, skill, 70)
    mine = next(s for s in client.get("/api/my/skills").json()["skills"] if s["slug"] == skill["slug"])
    assert (mine["attempts_used"], mine["attempts_left"], mine["state"]) == (1, 1, "practicing")
    assert upload(client, skill["id"]).status_code == 422  # allowed
    # an approval does not reset the count
    second = agency.attempt(cg, skill, 95, sent=True)
    agency.nurse.post(f"/api/attempts/{second}/review", json={"overall": "passed"})
    attempt = client.get(f"/api/attempts/{second}").json()
    assert attempt["attempts"] == {"used": 2, "allowed": 2, "left": 0}


def test_per_caregiver_limits_and_grants(agency):
    skill = agency.skill()
    cg, client = agency.caregiver()
    url = f"/api/caregivers/{cg}/skills/{skill['id']}"
    agency.nurse.put(f"/api/skills/{skill['id']}/policy", json={"max_attempts": 2})
    for _ in range(2):
        agency.attempt(cg, skill, 30)
    assert upload(client, skill["id"]).status_code == 409

    def standing(detail: dict) -> tuple:
        row = next(s for s in detail["skills"] if s["skill_id"] == str(skill["id"]))
        return (row["assigned"], row["limit_mode"], row["max_attempts"], row["attempts_used"],
                row["attempts_allowed"], row["attempts_left"])

    # grant: k more on top of max(allowed, used)
    assert standing(agency.nurse.patch(url, json={"grant": 1}).json()) == (True, "limited", 3, 2, 3, 1)
    assert upload(client, skill["id"]).status_code == 422
    assert standing(agency.nurse.patch(url, json={"grant": 2}).json()) == (True, "limited", 5, 2, 5, 3)
    # a lower limit than used leaves none, and a grant then counts from what was used
    assert standing(agency.nurse.patch(url, json={"max_attempts": 1}).json()) == (True, "limited", 1, 2, 1, 0)
    assert standing(agency.nurse.patch(url, json={"grant": 1}).json()) == (True, "limited", 3, 2, 3, 1)
    # unlimited for this caregiver only; a grant is then a no-op
    assert standing(agency.nurse.patch(url, json={"limit_mode": "unlimited"}).json()) == (
        True, "unlimited", None, 2, None, None)
    assert standing(agency.nurse.patch(url, json={"grant": 3}).json())[1] == "unlimited"
    other, other_client = agency.caregiver("Other Caregiver")
    for _ in range(2):
        agency.attempt(other, skill, 30)
    assert upload(other_client, skill["id"]).status_code == 409  # the skill's limit still applies to others
    # back to the skill's limit
    assert standing(agency.nurse.patch(url, json={"limit_mode": "inherit"}).json()) == (
        True, "inherit", None, 2, 2, 0)
    # the skill being unlimited: a grant is a no-op too
    agency.nurse.put(f"/api/skills/{skill['id']}/policy", json={"max_attempts": None})
    assert standing(agency.nurse.patch(url, json={"grant": 1}).json()) == (True, "inherit", None, 2, None, None)


def test_a_caregiver_limit_applies_to_every_skill_until_one_skill_sets_its_own(agency):
    first = agency.skill("First")
    second = agency.skill("Second")
    cg, client = agency.caregiver()
    agency.nurse.put(f"/api/skills/{first['id']}/policy", json={"max_attempts": 5})
    detail = agency.nurse.patch(f"/api/caregivers/{cg}", json={"skill_attempt_limit": 3}).json()
    assert detail["skill_attempt_limit"] == 3

    def allowed(body: dict, skill_id) -> int | None:
        return next(s for s in body["skills"] if s["skill_id"] == str(skill_id))["attempts_allowed"]

    assert allowed(detail, first["id"]) == 3 and allowed(detail, second["id"]) == 3
    # the skill's own number still shows for someone without a caregiver limit
    other = agency.caregiver("Other")[0]
    other_detail = agency.nurse.get(f"/api/caregivers/{other}").json()
    assert other_detail["skill_attempt_limit"] is None
    assert allowed(other_detail, first["id"]) == 5 and allowed(other_detail, second["id"]) is None
    # one skill can still have its own number, or unlimited
    detail = agency.nurse.patch(f"/api/caregivers/{cg}/skills/{second['id']}", json={"max_attempts": 1}).json()
    assert allowed(detail, second["id"]) == 1 and allowed(detail, first["id"]) == 3
    for _ in range(3):
        agency.attempt(cg, first, 40)
    assert upload(client, first["id"]).status_code == 409
    # clearing the caregiver limit returns the first skill to its own number
    detail = agency.nurse.patch(f"/api/caregivers/{cg}", json={"skill_attempt_limit": None}).json()
    assert detail["skill_attempt_limit"] is None
    assert allowed(detail, first["id"]) == 5 and allowed(detail, second["id"]) == 1
    assert agency.nurse.patch(f"/api/caregivers/{cg}", json={"skill_attempt_limit": 0}).status_code == 422
    assert agency.nurse.patch(f"/api/caregivers/{cg}", json={"skill_attempt_limit": 51}).status_code == 422


def test_caregiver_skill_patch_validation(agency):
    skill = agency.skill()
    cg, client = agency.caregiver()
    url = f"/api/caregivers/{cg}/skills/{skill['id']}"
    for body, words in [({"limit_mode": "sometimes"}, "'inherit'"), ({"max_attempts": 0}, "1 to 50"),
                        ({"max_attempts": 51}, "1 to 50"), ({"grant": 0}, "1 to 50"),
                        ({"limit_mode": "limited"}, "how many attempts")]:
        res = agency.nurse.patch(url, json=body)
        assert res.status_code == 422 and words in res.json()["detail"], (body, res.text)
    assert agency.nurse.patch(f"/api/caregivers/{cg}/skills/{uuid.uuid4()}", json={}).status_code == 404
    assert agency.nurse.patch(f"/api/caregivers/{agency.nurse_id}/skills/{skill['id']}", json={}).status_code == 404
    assert client.patch(url, json={"grant": 5}).status_code == 403


def test_picking_caregivers_limits_what_each_one_sees(agency):
    skill, other_skill = agency.skill("Picked skill"), agency.skill("Everyone's skill")
    alex, alex_client = agency.caregiver("Alex")
    blair, blair_client = agency.caregiver("Blair")
    url = f"/api/skills/{skill['id']}/policy"
    policy = agency.nurse.put(url, json={"assign_all": False, "assigned_ids": [str(alex)]}).json()
    assert policy["assign_all"] is False
    assert (_row(policy, alex)["assigned"], _row(policy, blair)["assigned"]) == (True, False)
    listed = {s["id"]: s for s in agency.nurse.get("/api/skills").json()}
    assert listed[str(skill["id"])]["policy"]["assigned_count"] == 1
    assert listed[str(other_skill["id"])]["policy"]["assigned_count"] == 2

    # Blair does not see, open or record it
    assert str(skill["id"]) not in [s["id"] for s in blair_client.get("/api/skills").json()]
    assert str(skill["id"]) not in [s["id"] for s in blair_client.get("/api/skills?all=1").json()]
    assert blair_client.get(f"/api/skills/{skill['id']}").status_code == 404
    assert [s["slug"] for s in blair_client.get("/api/my/skills").json()["skills"]] == [other_skill["slug"]]
    res = upload(blair_client, skill["id"])
    assert res.status_code == 403 and "not assigned to you" in res.json()["detail"]
    # Alex does
    assert alex_client.get(f"/api/skills/{skill['id']}").status_code == 200
    assert {s["slug"] for s in alex_client.get("/api/my/skills").json()["skills"]} == {skill["slug"], other_skill["slug"]}

    # the roster only counts assigned skills, and the detail lists the others separately
    roster = {p["id"]: p for p in agency.nurse.get("/api/caregivers").json()}
    assert (roster[str(alex)]["skills_total"], roster[str(blair)]["skills_total"]) == (2, 1)
    detail = agency.nurse.get(f"/api/caregivers/{blair}").json()
    assert [s["slug"] for s in detail["skills"]] == [other_skill["slug"]]
    assert [s["slug"] for s in detail["unassigned_skills"]] == [skill["slug"]]

    # assign Blair from her page
    detail = agency.nurse.patch(f"/api/caregivers/{blair}/skills/{skill['id']}", json={"assigned": True}).json()
    assert skill["slug"] in [s["slug"] for s in detail["skills"]] and detail["unassigned_skills"] == []
    assert blair_client.get(f"/api/skills/{skill['id']}").status_code == 200

    # switching off without a list keeps who was picked; back to everyone assigns all
    assert agency.nurse.put(url, json={"submit_pct": 75}).json()["assign_all"] is False
    assert agency.nurse.put(url, json={"assign_all": True}).json()["assign_all"] is True
    assert all(c["assigned"] for c in agency.nurse.get(url).json()["caregivers"])


def test_unassigning_one_caregiver_from_a_skill_everyone_has(agency):
    skill = agency.skill()
    alex, alex_client = agency.caregiver("Alex")
    blair, _ = agency.caregiver("Blair")
    detail = agency.nurse.patch(f"/api/caregivers/{alex}/skills/{skill['id']}", json={"assigned": False}).json()
    assert [s["slug"] for s in detail["unassigned_skills"]] == [skill["slug"]]
    policy = agency.nurse.get(f"/api/skills/{skill['id']}/policy").json()
    assert policy["assign_all"] is False
    assert (_row(policy, alex)["assigned"], _row(policy, blair)["assigned"]) == (False, True)
    assert alex_client.get(f"/api/skills/{skill['id']}").status_code == 404
    # a limit set for an unassigned caregiver does not assign them
    agency.nurse.patch(f"/api/caregivers/{alex}/skills/{skill['id']}", json={"max_attempts": 4})
    assert _row(agency.nurse.get(f"/api/skills/{skill['id']}/policy").json(), alex)["assigned"] is False


def test_unit_allowance_rules():
    pol = progress.policy({"max_attempts": 4, "submit_pct": 80, "force_pct": 50, "assign_all": False})
    assert progress.attempts_allowed(pol, None) == 4
    assert progress.attempts_allowed(pol, {"limit_mode": "limited", "max_attempts": 7}) == 7
    assert progress.attempts_allowed(pol, {"limit_mode": "unlimited", "max_attempts": 7}) is None
    # a caregiver's own number applies to every skill until one skill sets its own
    assert progress.attempts_allowed(pol, None, 3) == 3
    assert progress.attempts_allowed(pol, {"limit_mode": "inherit"}, 3) == 3
    assert progress.attempts_allowed(pol, {"limit_mode": "limited", "max_attempts": 7}, 3) == 7
    assert progress.attempts_allowed(pol, {"limit_mode": "unlimited"}, 3) is None
    assert not progress.is_assigned(pol, None) and progress.is_assigned(pol, {"assigned": True})
    assert progress.is_assigned(progress.policy(None), {"assigned": False})  # assign_all wins


def test_agencies_do_not_see_each_others_policies(agency):
    skill = agency.skill()
    cg, _ = agency.caregiver()
    other = Agency("Other")
    other_cg, other_client = other.caregiver()
    assert other.nurse.get(f"/api/skills/{skill['id']}/policy").status_code == 404
    assert other.nurse.put(f"/api/skills/{skill['id']}/policy", json={"max_attempts": 1}).status_code == 404
    assert other.nurse.patch(f"/api/caregivers/{cg}/skills/{skill['id']}", json={"grant": 1}).status_code == 404
    other_skill = other.skill()
    assert other.nurse.patch(f"/api/caregivers/{cg}/skills/{other_skill['id']}", json={"grant": 1}).status_code == 404
    assert upload(other_client, skill["id"]).status_code == 400  # not a skill of their agency
    # someone else's caregiver cannot be picked
    res = agency.nurse.put(f"/api/skills/{skill['id']}/policy", json={"assign_all": False,
                                                                       "assigned_ids": [str(other_cg)]})
    assert res.status_code == 422
    # the same slug in two agencies keeps two policies
    twin = other.skill(slug=skill["slug"])
    agency.nurse.put(f"/api/skills/{skill['id']}/policy", json={"max_attempts": 5})
    assert other.nurse.get(f"/api/skills/{twin['id']}/policy").json()["max_attempts"] is None
    assert [c["id"] for c in other.nurse.get(f"/api/skills/{twin['id']}/policy").json()["caregivers"]] == [str(other_cg)]
    assert db.fetch_one("SELECT count(*) AS n FROM skill_policies WHERE slug=%s", (skill["slug"],))["n"] == 1
