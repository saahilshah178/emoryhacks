"""Rubric stage and skills API. No Gemini calls: the stage's Gemini replies are stubbed."""
import time

import pytest
from fastapi.testclient import TestClient

from app import config, jobs, repo
from app.models import Classification
from app.stages import rubric
from app.stages.rubric import DraftRubric, DraftStep, StepBounds, WindowBounds, build_rubric, plan_windows

CLASSIFICATION = Classification(skill_slug="sit_to_stand", skill_name="Sit to stand", category="transfer",
                                confidence=1.0, summary="", people=[], order_matters=True)


def draft_step(number, start, end, title=None, prerequisites=(), critical=False, **evals):
    return DraftStep(
        number=number, title=title if title is not None else f"Step {number}", description=f"Do thing {number}.",
        start_s=start, end_s=end, critical=critical, prerequisites=list(prerequisites),
        pass_criteria=evals.get("pass_criteria", ["seen"]), fail_criteria=evals.get("fail_criteria", ["wrong"]),
        unverified_when=evals.get("unverified_when", ["hidden"]), visual_cues=evals.get("visual_cues", ["cue"]),
    )


def draft(*steps, safety=("Patient stays steady.",), order_matters=True):
    return DraftRubric(steps=list(steps), safety_criteria=list(safety), order_matters=order_matters, notes=" left out intro ")


def test_build_rubric_keeps_outline_order_and_renumbers_and_remaps_prerequisites():
    rb = build_rubric(draft(
        draft_step(3, 30, 40, "Stand up", prerequisites=[2, 1], critical=True),
        draft_step(1, 10, 20, "Lock brakes", critical=True),
        draft_step(2, 20, 30, "Explain", prerequisites=[3, 9, 2]),  # 3 is later, 9 unknown, 2 is itself
    ), duration=60)
    assert [s.title for s in rb.steps] == ["Lock brakes", "Explain", "Stand up"]
    assert [s.step_id for s in rb.steps] == ["s1", "s2", "s3"]
    assert [s.order for s in rb.steps] == [1, 2, 3]
    stand = rb.steps[2]
    assert stand.must_follow == ["s1", "s2"] and stand.order_dependent and stand.critical
    explain = rb.steps[1]
    assert explain.must_follow == [] and not explain.order_dependent
    assert rb.notes == "left out intro"


def test_refined_bounds_never_swap_steps_or_drop_a_prerequisite():
    """A refined start that lands before the previous step's start is not used: the step keeps
    its outline time, so brakes still come before standing and standing still requires them."""
    rb = build_rubric(draft(
        draft_step(1, 0, 8, "Position the wheelchair"),
        draft_step(2, 10, 14, "Lock wheelchair brakes", critical=True),
        draft_step(3, 14, 18, "Stand the patient", prerequisites=[2], critical=True),
        draft_step(4, 18, 24, "Pivot to the chair", prerequisites=[3]),
    ), duration=30, bounds={2: (14.0, 18.0), 3: (12.0, 16.0)})
    assert [s.title for s in rb.steps] == ["Position the wheelchair", "Lock wheelchair brakes",
                                           "Stand the patient", "Pivot to the chair"]
    stand = rb.steps[2]
    assert stand.must_follow == ["s2"] and stand.order_dependent
    assert (rb.steps[1].start_s, stand.start_s) == (14.0, 14.0)  # refined brakes kept; stand clamped, not moved before
    assert rb.steps[3].must_follow == ["s3"]


def test_outline_times_out_of_order_are_clamped_so_starts_never_go_backwards():
    rb = build_rubric(draft(draft_step(1, 10, 16, "A"), draft_step(2, 8, 12, "B", prerequisites=[1])), duration=30)
    assert [(s.title, s.start_s, s.must_follow) for s in rb.steps] == [("A", 10.0, []), ("B", 10.0, ["s1"])]


def test_a_step_genuinely_repeated_is_kept_and_a_replay_is_dropped():
    rb = build_rubric(draft(
        draft_step(1, 0, 5, "Perform hand hygiene"),
        draft_step(2, 5, 12, "Remove first glove"),
        draft_step(3, 6, 11, "Remove first glove"),                   # replay of 2: overlapping span
        draft_step(4, 12, 20, "Remove second glove", prerequisites=[3]),  # names the replay
        draft_step(5, 25, 35, "Perform hand hygiene", prerequisites=[4]),
    ), duration=40)
    assert [s.title for s in rb.steps] == ["Perform hand hygiene", "Remove first glove", "Remove second glove",
                                           "Perform hand hygiene (again)"]
    assert rb.steps[2].must_follow == ["s2"] and rb.steps[3].must_follow == ["s3"]


def test_build_rubric_clamps_times_and_drops_empty_and_duplicate_steps():
    rb = build_rubric(draft(
        draft_step(1, -5, 3),
        draft_step(2, 50, 45),              # end before start
        draft_step(3, 58, 90),              # runs past the end of the video
        draft_step(4, 10, 12, title="  "),  # empty title
        draft_step(5, 1, 2, title="step 1!"),  # a replay of "Step 1" (same title after normalising, overlapping)
        draft_step(6, 70, 80),              # starts after the end of the video
    ), duration=60)
    times = [(s.title, s.start_s, s.end_s) for s in rb.steps]
    assert times == [("Step 1", 0, 3), ("Step 2", 50, 51), ("Step 3", 58, 59), ("Step 6", 59, 60)]
    assert all(0 <= s.start_s < s.end_s <= 60 for s in rb.steps)


def test_build_rubric_fills_empty_eval_lists_and_caps_long_ones():
    rb = build_rubric(draft(
        draft_step(1, 0, 5, pass_criteria=[" ", ""], fail_criteria=[], unverified_when=[], visual_cues=[]),
        draft_step(2, 5, 9, pass_criteria=[f"p{i}" for i in range(7)] + ["P1"]),
    ), duration=10)
    first = rb.steps[0].evals
    assert first.pass_criteria and first.fail_criteria and first.unverified_when and first.visual_cues
    assert rb.steps[1].evals.pass_criteria == ["p0", "p1", "p2", "p3"]
    empty_safety = build_rubric(draft(draft_step(1, 0, 5), safety=[" "]), duration=10)
    assert empty_safety.safety_criteria


def test_build_rubric_applies_bounds_trims_overlaps_and_derives_order_matters():
    rb = build_rubric(draft(
        draft_step(1, 0, 10),
        draft_step(2, 10, 20, prerequisites=[1]),
        order_matters=False,
    ), duration=30, bounds={1: (2.04, 14.0), 2: (12.0, 18.0)})
    assert [(s.start_s, s.end_s) for s in rb.steps] == [(2.0, 12.0), (12.0, 18.0)]
    assert rb.order_matters  # a step with a prerequisite means order matters


def test_build_rubric_renumbers_repeated_step_numbers_by_position():
    rb = build_rubric(draft(draft_step(1, 0, 5, "A"), draft_step(1, 5, 9, "B", prerequisites=[1]),
                            draft_step(1, 9, 12, "C", prerequisites=[2])), duration=20)
    assert [(s.title, s.must_follow) for s in rb.steps] == [("A", []), ("B", ["s1"]), ("C", ["s2"])]


def test_build_rubric_rejects_a_draft_with_no_usable_steps():
    with pytest.raises(ValueError):
        build_rubric(draft(draft_step(1, 0, 5, title="")), duration=10)


def test_plan_windows_groups_consecutive_steps_within_the_limit():
    steps = [draft_step(i + 1, 40 * i, 40 * i + 35) for i in range(6)]  # 0..235 s
    windows = plan_windows(steps, duration=240)
    assert sorted(i for w in windows for i in w.members) == list(range(6))
    assert all(w.end_s - w.start_s <= rubric.WINDOW_MAX_S for w in windows)
    assert len(windows) < 6
    for w in windows:
        for i in w.members:
            assert w.start_s <= steps[i].start_s and steps[i].end_s <= w.end_s


class StubCtx:
    """Stands in for jobs.StageContext: records requests and returns canned replies."""

    def __init__(self, outline, bounds_reply):
        self.duration = 60.0
        self.outline, self.bounds_reply = outline, bounds_reply
        self.calls, self.logs = [], []

    def video_part(self, **kwargs):
        return {"type": "video", **kwargs}

    def generate_json(self, purpose, parts, schema, **kwargs):
        self.calls.append((purpose, parts[0], kwargs))
        return self.outline if schema is DraftRubric else self.bounds_reply

    def log(self, message):
        self.logs.append(message)


def test_run_refines_bounds_and_rejects_answers_outside_the_clip(monkeypatch):
    monkeypatch.setattr(config, "FAKE_AI", False)
    outline = draft(draft_step(1, 5, 12, "Explain"), draft_step(2, 12, 30, "Stand up", prerequisites=[1]))
    reply = WindowBounds(steps=[StepBounds(number=1, found=True, start_s=6.0, end_s=11.0),
                                StepBounds(number=2, found=True, start_s=200.0, end_s=210.0)])
    ctx = StubCtx(outline, reply)
    rb = rubric.run(ctx, CLASSIFICATION)
    assert [c[0] for c in ctx.calls] == ["rubric_outline", "rubric_bounds"]
    clip = ctx.calls[1][1]
    assert clip["fps"] == rubric.REFINE_FPS and clip["start_s"] <= 5 and clip["end_s"] >= 30
    assert [(s.start_s, s.end_s) for s in rb.steps] == [(6.0, 11.0), (12.0, 30.0)]
    assert rb.steps[1].must_follow == ["s1"]


def test_run_uses_canned_rubric_in_fake_mode():
    ctx = jobs.StageContext(job_id=None, video={"id": None, "duration_s": 40})
    rb = rubric.run(ctx, CLASSIFICATION)
    assert len(rb.steps) == 4 and rb.steps[0].step_id == "s1"


def _wait(client, job_id, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.3)
    raise AssertionError("job did not finish")


def test_skills_api_edit_and_regenerate(migrated, sample_video):
    from app.main import app

    ref = jobs.ingest(str(sample_video), "reference", sample_video.name)
    job_id = repo.create_job("reference", ref["id"])
    jobs.run_reference(job_id, slug="sit_to_stand", name="Sit to stand")
    skill_id = str(repo.get_job(job_id)["skill_id"])

    with TestClient(app) as client:
        skill = client.get(f"/api/skills/{skill_id}").json()
        assert skill["version"] >= 1 and skill["video"]["id"] == str(ref["id"]) and skill["people"]

        renamed = client.patch(f"/api/skills/{skill_id}", json={"name": "Sit to stand, assisted", "summary": "S"}).json()
        assert renamed["name"] == "Sit to stand, assisted"

        evals = {"pass_criteria": ["a"], "fail_criteria": ["b"], "unverified_when": ["c"], "visual_cues": ["d"]}
        edited = client.patch(f"/api/skills/{skill_id}/steps/s2",
                              json={"title": "Feet back", "critical": False, "start_s": 1, "end_s": 4, "evals": evals}).json()
        s2 = edited["steps"][1]
        assert (s2["title"], s2["critical"], s2["start_s"], s2["end_s"]) == ("Feet back", False, 1, 4)
        assert s2["evals"] == evals
        assert client.patch(f"/api/skills/{skill_id}/steps/s2", json={"start_s": 5}).status_code == 422
        assert client.patch(f"/api/skills/{skill_id}/steps/s99", json={"title": "x"}).status_code == 404

        started = client.post(f"/api/skills/{skill_id}/regenerate")
        assert started.status_code == 200
        job = _wait(client, started.json()["job_id"])
        assert job["status"] == "done", job["error"]
        assert [s["name"] for s in job["stages"]] == ["gemini_upload", "rubric"]
        new_id = job["skill_id"]
        assert new_id != skill_id  # a rebuild is stored as a new version
        rebuilt = client.get(f"/api/skills/{new_id}").json()
        assert rebuilt["version"] == skill["version"] + 1
        assert rebuilt["steps"][1]["title"] != "Feet back"  # the canned rubric, not the edited one
        assert rebuilt["name"] == "Sit to stand, assisted"  # skill identity is kept
        old = client.get(f"/api/skills/{skill_id}").json()
        assert old["steps"][1]["title"] == "Feet back" and old["latest_id"] == new_id  # the old version is untouched
        assert client.post("/api/skills/00000000-0000-0000-0000-000000000000/regenerate").status_code == 404
