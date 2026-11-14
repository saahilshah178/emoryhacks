"""The nine standard skills: installed from the file without Gemini, once, and kept."""
import uuid

from fastapi.testclient import TestClient

from app import builtin, catalog, db, repo
from app.main import app
from scripts import builtin_skills


def _org() -> uuid.UUID:
    org_id = uuid.uuid4()
    db.execute("INSERT INTO orgs (id, name) VALUES (%s, %s)", (org_id, f"Agency {org_id.hex[:6]}"))
    return org_id


def test_the_file_is_sound():
    skills = builtin.load()
    assert [s["slug"] for s in skills] == list(catalog.REFERENCE_FILES)
    assert builtin_skills.problems(skills) == []


def test_ensure_installs_each_skill_once_with_timed_steps_and_criteria(migrated):
    org_id = _org()
    assert sorted(builtin.ensure(org_id)) == sorted(builtin.SLUGS)
    assert builtin.ensure(org_id) == []  # a second start adds nothing

    skills = repo.list_skills(org_id=org_id)
    assert sorted(s["slug"] for s in skills) == sorted(builtin.SLUGS)
    for row in skills:
        skill = repo.get_skill(row["id"])
        assert skill["version"] == 1 and skill["video"]["available"], row["slug"]
        assert skill["video"]["original_name"] == catalog.REFERENCE_FILES[row["slug"]]["primary"]
        for step in skill["steps"]:
            assert 0 <= step["start_s"] < step["end_s"] <= skill["video"]["duration_s"] + 1
            assert step["evals"]["pass_criteria"] and step["evals"]["fail_criteria"]
        rubric = repo.get_rubric(row["id"])  # what the grading stages are given
        assert len(rubric.steps) == len(skill["steps"])


def test_ensure_leaves_an_agencys_own_version_alone(migrated):
    org_id = _org()
    builtin.ensure(org_id)
    skill = next(s for s in repo.list_skills(org_id=org_id) if s["slug"] == "glove_removal")
    repo.patch_skill(skill["id"], {"summary": "Edited by a nurse."})
    assert builtin.ensure(org_id) == []
    assert repo.get_skill(skill["id"])["summary"] == "Edited by a nurse."


def test_the_last_version_of_a_standard_skill_cannot_be_deleted(migrated):
    builtin.ensure()
    client = TestClient(app)  # signed in as a nurse of the default agency (conftest)
    skill = next(s for s in client.get("/api/skills").json() if s["slug"] == "sit_to_stand")
    if len(client.get(f"/api/skills/{skill['id']}").json()["versions"]) == 1:
        refused = client.delete(f"/api/skills/{skill['id']}")
        assert refused.status_code == 409 and "standard skills" in refused.json()["detail"]
    assert any(s["slug"] == "sit_to_stand" for s in client.get("/api/skills").json())
