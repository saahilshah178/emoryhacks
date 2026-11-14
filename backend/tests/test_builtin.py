"""The nine standard skills: installed from the file without Gemini, upgraded to a revised
rubric as a new version where no nurse has changed them, and otherwise kept."""
import copy
import json
import subprocess
import threading
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import auth, builtin, catalog, db, repo
from app.models import Classification, Rubric, RubricStep, StepEval
from app.stages import sight
from app.main import app
from scripts import builtin_skills

# The file as it was before revisions: what databases made until then were given, as version 1.
REVISION_1 = "c04aa17"


def _org() -> uuid.UUID:
    org_id = uuid.uuid4()
    db.execute("INSERT INTO orgs (id, name) VALUES (%s, %s)", (org_id, f"Agency {org_id.hex[:6]}"))
    return org_id


@pytest.fixture(scope="module")
def revision_1() -> list[dict]:
    root = Path(__file__).resolve().parents[2]
    try:
        text = subprocess.run(["git", "show", f"{REVISION_1}:backend/app/builtin_skills.json"], cwd=root,
                              capture_output=True, text=True, check=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        pytest.skip(f"the old file is not in this checkout's history ({REVISION_1})")
    return json.loads(text)["skills"]


def _install_revision_1(org_id, skills: list[dict]) -> dict[str, uuid.UUID]:
    """What builtin.ensure did before revisions existed: version 1 under ids derived from the
    agency and slug, and no applies_when. Returns {slug: skill_id}."""
    ids = {}
    for skill in skills:
        slug, video = skill["slug"], skill["video"]
        video_id, skill_id = builtin._id(org_id, "video", slug), builtin._id(org_id, "skill", slug)
        with db.tx() as conn:
            conn.execute(
                """INSERT INTO videos (id, kind, original_name, path, duration_s, width, height, fps, org_id)
                   VALUES (%s,'reference',%s,%s,%s,%s,%s,%s,%s)""",
                (video_id, video["original_name"], repo.NO_FILE, video["duration_s"], video["width"],
                 video["height"], video["fps"], org_id))
            conn.execute(
                """INSERT INTO skills (id, slug, name, category, summary, version, order_matters, safety_criteria,
                                       people, classification, notes, reference_video_id, org_id, guide)
                   VALUES (%s,%s,%s,%s,%s,1,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (skill_id, slug, skill["name"], skill["category"], skill["summary"], skill["order_matters"],
                 db.J(skill["safety_criteria"]), db.J(skill["people"]), db.J(skill["classification"]),
                 skill["notes"], video_id, org_id, db.J(skill.get("guide") or {})))
            for step in skill["steps"]:
                conn.execute(
                    """INSERT INTO skill_steps (id, skill_id, step_id, ord, title, description, start_s, end_s,
                                                critical, order_dependent, must_follow, evals)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (builtin._id(org_id, "step", f"{slug}:{step['step_id']}"), skill_id, step["step_id"],
                     step["ord"], step["title"], step["description"], step["start_s"], step["end_s"],
                     step["critical"], step["order_dependent"], db.J(step["must_follow"]), db.J(step["evals"])))
        ids[slug] = skill_id
    return ids


def _snapshot(skill_id) -> dict:
    skill = repo.get_skill(skill_id)
    return {"version": skill["version"], "updated_at": skill["updated_at"],
            "fingerprint": builtin.fingerprint(skill, skill["steps"]),
            "steps": [(s["step_id"], s["title"], s["evals"]) for s in skill["steps"]]}


def _newest(org_id) -> dict[str, dict]:
    return {s["slug"]: s for s in repo.list_skills(org_id=org_id)}


# --- the file -------------------------------------------------------------
def test_the_file_is_sound():
    skills = builtin.load()
    assert [s["slug"] for s in skills] == list(catalog.REFERENCE_FILES)
    assert builtin_skills.problems(skills) == []


def test_the_file_can_be_graded_by_sight_alone():
    for skill in builtin.load():
        assert sight.speech_problems(skill["steps"]) == [], skill["slug"]
        assert not [c for c in skill["safety_criteria"] if sight.spoken_words(c)], skill["slug"]
        for step in skill["steps"]:
            assert isinstance(step["applies_when"], str), (skill["slug"], step["step_id"])
            assert len(step["evals"]["pass_criteria"]) >= 2 and step["evals"]["fail_criteria"], step["title"]
    fall = next(s for s in builtin.load() if s["slug"] == "fall_response")
    assert "cannot get up" in fall["steps"][-1]["applies_when"]  # the call bell


def test_the_check_names_each_kind_of_problem():
    skill = copy.deepcopy(next(s for s in builtin.load() if s["slug"] == "fall_response"))
    skill["steps"][0]["evals"]["pass_criteria"].append("Caregiver asks the patient how they feel.")
    skill["safety_criteria"].append("The caregiver explains each move.")
    del skill["steps"][1]["applies_when"]
    skill["steps"][2]["must_follow"] = ["s5"]
    skill["steps"][3]["step_id"] = "s9"
    del skill["revision"]
    found = "\n".join(builtin_skills.problems([skill]))
    assert "fall_response s1 (Move to the patient and steady them) pass_criteria[2]: depends on speech (asks)" in found
    assert "safety_criteria[4]: depends on speech (explains)" in found
    assert "fall_response s2 (Position yourself closely behind the patient): no applies_when" in found
    assert "must_follow names steps that are not before it ['s5']" in found
    assert "steps are not s1..s7 with ord 1..7 in order" in found
    assert "fall_response: no revision" in found


# --- installing and upgrading ---------------------------------------------
def test_a_new_agency_gets_the_current_revision_once(migrated):
    org_id = _org()
    added = builtin.ensure(org_id)
    assert sorted(c["slug"] for c in added) == sorted(builtin.SLUGS)
    assert {(c["kind"], c["version"]) for c in added} == {("added", 1)}
    assert builtin.ensure(org_id) == []  # a second start adds nothing

    file = {s["slug"]: s for s in builtin.load()}
    skills = repo.list_skills(org_id=org_id)
    assert sorted(s["slug"] for s in skills) == sorted(builtin.SLUGS)
    for row in skills:
        skill = repo.get_skill(row["id"])
        assert skill["version"] == 1 and skill["video"]["available"], row["slug"]
        assert skill["video"]["original_name"] == catalog.REFERENCE_FILES[row["slug"]]["primary"]
        assert builtin.fingerprint(skill, skill["steps"]) == builtin.fingerprint(file[row["slug"]],
                                                                                file[row["slug"]]["steps"])
        for step in skill["steps"]:
            assert 0 <= step["start_s"] < step["end_s"] <= skill["video"]["duration_s"] + 1
            assert step["evals"]["pass_criteria"] and step["evals"]["fail_criteria"]
        rubric = repo.get_rubric(row["id"])  # what the grading stages are given
        assert len(rubric.steps) == len(skill["steps"])
    call_bell = repo.get_rubric(next(s["id"] for s in skills if s["slug"] == "fall_response")).steps[-1]
    assert call_bell.applies_when == file["fall_response"]["steps"][-1]["applies_when"]


def test_the_old_file_matches_the_fingerprints_the_new_one_replaces(migrated, revision_1):
    """The fingerprint of revision 1 as a database holds it (4-byte times, no applies_when)
    is the one the file lists, so the databases in use are recognised as unchanged."""
    org_id = _org()
    ids = _install_revision_1(org_id, revision_1)
    file = {s["slug"]: s for s in builtin.load()}
    for slug, skill_id in ids.items():
        skill = repo.get_skill(skill_id)
        assert builtin.fingerprint(skill, skill["steps"]) in file[slug]["replaces"], slug


def test_an_unchanged_old_version_gets_the_revision_as_a_new_version(migrated, revision_1):
    org_id = _org()
    old = _install_revision_1(org_id, revision_1)
    sit = old["sit_to_stand"]
    video = repo.create_video("attempt", repo.NO_FILE, "attempt.mp4", {"duration_s": 30}, org_id=org_id)
    attempt_id = repo.create_attempt(sit, video["id"], caregiver_name="Test caregiver")
    graded_steps = [s["step_id"] for s in repo.get_attempt(attempt_id)["steps"]]
    # A nurse's caregiver-facing copy is not part of the rubric, and goes with it to the new version.
    repo.patch_skill(old["glove_removal"], {"guide": {"description": "Take your gloves off safely."}})
    before = {slug: _snapshot(skill_id) for slug, skill_id in old.items()}

    changes = builtin.ensure(org_id)

    assert sorted(c["slug"] for c in changes) == sorted(builtin.SLUGS)
    assert {(c["kind"], c["version"], c["revision"]) for c in changes} == {("updated", 2, 2)}
    assert all(line.endswith("as version 2") for line in builtin.describe(changes))
    file = {s["slug"]: s for s in builtin.load()}
    newest = _newest(org_id)
    for slug, skill_id in old.items():
        assert _snapshot(skill_id) == before[slug], slug  # the old version is untouched
        assert newest[slug]["version"] == 2 and newest[slug]["id"] != skill_id
        new = repo.get_skill(newest[slug]["id"])
        assert new["reference_video_id"] == repo.get_skill(skill_id)["reference_video_id"]
        assert builtin.fingerprint(new, new["steps"]) == builtin.fingerprint(file[slug], file[slug]["steps"])
    assert db.fetch_one("SELECT guide FROM skills WHERE id=%s", (newest["glove_removal"]["id"],))["guide"] == {
        "description": "Take your gloves off safely."}
    # The attempt still belongs to the version it was graded against, with that version's steps.
    attempt = repo.get_attempt(attempt_id)
    assert attempt["skill_id"] == sit and [s["step_id"] for s in attempt["steps"]] == graded_steps
    assert len(repo.get_skill(sit)["steps"]) == 7 and len(repo.get_skill(newest["sit_to_stand"]["id"])["steps"]) == 6

    assert builtin.ensure(org_id) == []  # running it again changes nothing
    assert len(repo.list_skills(all_versions=True, org_id=org_id)) == 18


def test_a_caregiver_is_given_the_new_version(migrated, revision_1):
    """The skill list a caregiver works from is the newest version of each skill."""
    org_id = _org()
    _install_revision_1(org_id, revision_1)
    builtin.ensure(org_id)
    caregiver = auth.create_user(org_id=org_id, role="caregiver", name="Test Caregiver",
                                 email=f"caregiver.{org_id.hex[:8]}@example.test", password=None)
    client = TestClient(app)
    client.headers["authorization"] = f"Bearer {auth.create_session(caregiver)}"

    listed = {s["slug"]: s for s in client.get("/api/skills").json()}
    assert sorted(listed) == sorted(builtin.SLUGS)
    assert {s["version"] for s in listed.values()} == {2}
    listed = listed["fall_response"]
    steps = repo.get_skill(listed["id"])["steps"]
    assert steps[0]["title"] == "Move to the patient and steady them" and steps[-1]["applies_when"]


def test_the_database_the_file_came_from_is_upgraded_too(migrated, revision_1):
    """Revision 1 was exported from skills the rubric stage built: random ids, an uploaded
    reference video and earlier versions. Their content is the file's, so they are upgraded."""
    org_id = _org()
    skill = next(s for s in revision_1 if s["slug"] == "fall_response")
    classification = Classification(**skill["classification"])
    reference = repo.create_video("reference", repo.NO_FILE, skill["video"]["original_name"],
                                  {"duration_s": skill["video"]["duration_s"]}, org_id=org_id)
    rubric = Rubric(steps=[RubricStep(order=s["ord"], evals=StepEval(**s["evals"]),
                                      **{k: s[k] for k in ("step_id", "title", "description", "start_s", "end_s",
                                                          "critical", "order_dependent", "must_follow")})
                           for s in skill["steps"]],
                    safety_criteria=skill["safety_criteria"], order_matters=skill["order_matters"], notes=skill["notes"])
    draft = rubric.model_copy(deep=True)
    draft.steps[0].title = "An earlier draft"
    repo.create_skill(classification, draft, reference["id"], slug="fall_response", name=skill["name"])
    exported = repo.create_skill(classification, rubric, reference["id"], slug="fall_response", name=skill["name"])
    db.execute("UPDATE skills SET summary=%s, people=%s WHERE id=%s",  # as the classify stage left them
               (skill["summary"], db.J(skill["people"]), exported))

    assert [(c["slug"], c["version"]) for c in builtin.ensure(org_id) if c["slug"] == "fall_response"] == [
        ("fall_response", 3)]
    new = repo.get_skill(_newest(org_id)["fall_response"]["id"])
    assert new["reference_video_id"] == reference["id"] and new["steps"][-1]["applies_when"]
    assert repo.get_skill(exported)["version"] == 2


def test_a_nurses_own_version_is_left_alone(migrated, revision_1):
    org_id = _org()
    old = _install_revision_1(org_id, revision_1)
    # Edited: one criterion of glove removal.
    step = repo.get_skill(old["glove_removal"])["steps"][0]
    evals = {**step["evals"], "pass_criteria": step["evals"]["pass_criteria"] + ["Nurse's own criterion."]}
    repo.patch_step(old["glove_removal"], step["step_id"], {"evals": evals})
    # Rebuilt: a newer version of stair assistance from the rubric stage, on the same reference.
    stairs = repo.get_skill(old["stair_assistance"])
    rubric = repo.get_rubric(stairs["id"])
    rubric.steps[0].title = "Talk through the railing at home"  # the rubric stage words things its own way
    rebuilt = repo.create_skill(Classification(**stairs["classification"]), rubric,
                                stairs["reference_video_id"], slug="stair_assistance", name=stairs["name"])
    # A new reference recorded for shower assistance.
    reference = repo.create_video("reference", repo.NO_FILE, "nurse.mp4", {"duration_s": 60}, org_id=org_id)
    shower = repo.get_skill(old["shower_assistance"])
    recorded = repo.create_skill(Classification(**shower["classification"]), repo.get_rubric(shower["id"]),
                                 reference["id"], slug="shower_assistance", name=shower["name"])
    before = {skill_id: _snapshot(skill_id) for skill_id in (old["glove_removal"], rebuilt, recorded)}

    changes = builtin.ensure(org_id)

    assert sorted(c["slug"] for c in changes) == sorted(set(builtin.SLUGS) - {
        "glove_removal", "stair_assistance", "shower_assistance"})
    newest = _newest(org_id)
    assert newest["glove_removal"]["id"] == old["glove_removal"]
    assert newest["stair_assistance"]["id"] == rebuilt and newest["shower_assistance"]["id"] == recorded
    for skill_id, snapshot in before.items():
        assert _snapshot(skill_id) == snapshot
    assert builtin.ensure(org_id) == []


def test_an_edit_on_a_new_install_is_kept(migrated):
    org_id = _org()
    builtin.ensure(org_id)
    skill = _newest(org_id)["glove_removal"]
    repo.patch_skill(skill["id"], {"summary": "Edited by a nurse."})
    assert builtin.ensure(org_id) == []
    assert repo.get_skill(skill["id"])["summary"] == "Edited by a nurse."


def test_a_deleted_revision_is_not_put_back(migrated, revision_1):
    org_id = _org()
    old = _install_revision_1(org_id, [s for s in revision_1 if s["slug"] == "fall_response"])
    builtin.ensure(org_id)
    new_id = _newest(org_id)["fall_response"]["id"]
    repo.delete_skill(new_id)  # the nurse prefers the version she had
    assert builtin.ensure(org_id) == []
    assert _newest(org_id)["fall_response"]["id"] == old["fall_response"]


def test_two_servers_starting_at_once_install_each_skill_once(migrated, revision_1):
    for start in ("fresh", "upgrade"):
        org_id = _org()
        if start == "upgrade":
            _install_revision_1(org_id, revision_1)
        results, errors = [], []

        def run():
            try:
                results.append(builtin.ensure(org_id))
            except Exception as exc:  # noqa: BLE001 - reported below
                errors.append(exc)

        threads = [threading.Thread(target=run) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert errors == []
        assert sorted(c["slug"] for r in results for c in r) == sorted(builtin.SLUGS), start
        assert len(repo.list_skills(all_versions=True, org_id=org_id)) == (9 if start == "fresh" else 18)


def test_export_writes_the_revision_and_applies_when(migrated):
    org_id = _org()
    builtin.ensure(org_id)
    file = {s["slug"]: s for s in builtin.load()}
    exported = {s["slug"]: s for s in builtin.export(org_id)}
    for slug, entry in exported.items():
        assert (entry["revision"], entry["replaces"]) == (file[slug]["revision"], file[slug]["replaces"])
        assert [s["applies_when"] for s in entry["steps"]] == [s["applies_when"] for s in file[slug]["steps"]]
    assert builtin_skills.problems(list(exported.values())) == []

    # An improved rubric becomes the next revision, replacing the file's.
    fall = _newest(org_id)["fall_response"]["id"]
    repo.patch_step(fall, "s2", {"title": "Stand close behind the patient"})
    entry = next(s for s in builtin.export(org_id) if s["slug"] == "fall_response")
    before = file["fall_response"]
    assert entry["revision"] == before["revision"] + 1
    assert entry["replaces"] == before["replaces"] + [builtin.fingerprint(before, before["steps"])]


def test_export_refuses_a_database_behind_the_file(migrated, revision_1):
    org_id = _org()
    _install_revision_1(org_id, revision_1)
    with pytest.raises(ValueError, match="older revision"):
        builtin.export(org_id)


def test_the_last_version_of_a_standard_skill_cannot_be_deleted(migrated):
    builtin.ensure()
    client = TestClient(app)  # signed in as a nurse of the default agency (conftest)
    skill = next(s for s in client.get("/api/skills").json() if s["slug"] == "sit_to_stand")
    if len(client.get(f"/api/skills/{skill['id']}").json()["versions"]) == 1:
        refused = client.delete(f"/api/skills/{skill['id']}")
        assert refused.status_code == 409 and "standard skills" in refused.json()["detail"]
    assert any(s["slug"] == "sit_to_stand" for s in client.get("/api/skills").json())


def test_make_skills_reports_what_it_did(migrated, capsys):
    assert builtin_skills.main(["install"]) == 0
    assert builtin_skills.main(["install"]) == 0  # the default agency is current by now
    assert "All nine standard skills are here" in capsys.readouterr().out.splitlines()[-1]
    assert builtin_skills.main(["check"]) == 0
