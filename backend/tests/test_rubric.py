"""Rubric stage and skills API. No Gemini calls: the stage's Gemini replies are stubbed."""
import time

import pytest
from fastapi.testclient import TestClient

from app import config, gemini, jobs, repo
from app.models import Classification
from app.stages import rubric, sight
from app.stages.rubric import (
    DraftRubric, DraftStep, PieceFix, SightRepair, StepBounds, WindowBounds, build_rubric, enforce_sight,
    plan_windows,
)

CLASSIFICATION = Classification(skill_slug="sit_to_stand", skill_name="Sit to stand", category="transfer",
                                confidence=1.0, summary="", people=[], order_matters=True)


def draft_step(number, start, end, title=None, prerequisites=(), critical=False, applies_when="", description=None,
               **evals):
    return DraftStep(
        number=number, title=title if title is not None else f"Step {number}",
        description=description if description is not None else f"Do thing {number}.",
        start_s=start, end_s=end, critical=critical, applies_when=applies_when, prerequisites=list(prerequisites),
        pass_criteria=evals.get("pass_criteria", ["seen"]), fail_criteria=evals.get("fail_criteria", ["wrong"]),
        unverified_when=evals.get("unverified_when", ["hidden"]), visual_cues=evals.get("visual_cues", ["hands move"]),
    )


def draft(*steps, safety=("Patient stays steady.",), order_matters=True):
    return DraftRubric(steps=list(steps), safety_criteria=list(safety), order_matters=order_matters, notes=" left out intro ")


def test_build_rubric_keeps_outline_order_and_renumbers_and_remaps_prerequisites():
    rb = build_rubric(draft(
        draft_step(3, 30, 40, "Stand up", prerequisites=[2, 1], critical=True),
        draft_step(1, 10, 20, "Lock brakes", critical=True),
        draft_step(2, 20, 30, "Position feet", prerequisites=[3, 9, 2]),  # 3 is later, 9 unknown, 2 is itself
    ), duration=60)
    assert [s.title for s in rb.steps] == ["Lock brakes", "Position feet", "Stand up"]
    assert [s.step_id for s in rb.steps] == ["s1", "s2", "s3"]
    assert [s.order for s in rb.steps] == [1, 2, 3]
    stand = rb.steps[2]
    assert stand.must_follow == ["s1", "s2"] and stand.order_dependent and stand.critical
    feet = rb.steps[1]
    assert feet.must_follow == [] and not feet.order_dependent
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
    """Stands in for jobs.StageContext: records requests and returns canned replies. sight_reply
    answers the sight repair call; an exception there is raised, as a skipped call would be."""

    def __init__(self, outline, bounds_reply, sight_reply=None):
        self.duration = 60.0
        self.outline, self.bounds_reply, self.sight_reply = outline, bounds_reply, sight_reply
        self.calls, self.logs = [], []

    def video_part(self, **kwargs):
        return {"type": "video", **kwargs}

    def generate_json(self, purpose, parts, schema, **kwargs):
        self.calls.append((purpose, parts[0], kwargs))
        if schema is SightRepair:
            self.sight_parts = parts
            if isinstance(self.sight_reply, Exception):
                raise self.sight_reply
            return self.sight_reply or SightRepair(remove_steps=[], fixes=[])
        return self.outline if schema is DraftRubric else self.bounds_reply

    def log(self, message):
        self.logs.append(message)


def test_run_refines_bounds_and_rejects_answers_outside_the_clip(monkeypatch):
    monkeypatch.setattr(config, "FAKE_AI", False)
    outline = draft(draft_step(1, 5, 12, "Position feet"), draft_step(2, 12, 30, "Stand up", prerequisites=[1]))
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
    # The canned rubric is sight-only like a real one, and shows a step that is only sometimes needed.
    assert sight.speech_problems(s.model_dump() for s in rb.steps) == []
    assert not any(sight.spoken_words(t) for t in rb.safety_criteria)
    assert [s.step_id for s in rb.steps if s.applies_when] == ["s4"]


# --- only-needed-when steps ---------------------------------------------------
def test_applies_when_from_the_outline_reaches_the_rubric_as_a_clause():
    rb = build_rubric(draft(
        draft_step(1, 0, 5, "Lower the patient to the floor", critical=True),
        draft_step(2, 5, 10, "Press the call bell", applies_when="Only needed when the patient cannot get up unaided."),
        draft_step(3, 10, 15, "Fold up the footrests", applies_when="If the wheelchair has footrests"),
        draft_step(4, 15, 20, "Help the patient up", applies_when=" none "),
        draft_step(5, 20, 25, "Check the patient over", applies_when="Always."),
        draft_step(6, 25, 30, "Put on non-skid socks", applies_when="BP cuff is on the arm"),
    ), duration=30)
    assert [s.applies_when for s in rb.steps] == [
        "", "the patient cannot get up unaided", "the wheelchair has footrests", "", "", "BP cuff is on the arm"]
    assert "critical" not in rb.notes  # no critical step has a condition


def test_a_critical_step_may_have_a_condition_but_the_nurse_is_told_to_check_it():
    rb = build_rubric(draft(
        draft_step(1, 0, 5, "Lower the patient to the floor", critical=True),
        draft_step(2, 5, 10, "Press the call bell", critical=True, applies_when="the patient is hurt"),
    ), duration=30)
    bell = rb.steps[1]
    assert bell.critical and bell.applies_when == "the patient is hurt"
    assert '"Press the call bell" is critical but only needed when the patient is hurt' in rb.notes


# --- sight only: what the code enforces --------------------------------------
def _speech_draft():
    """A fall-response outline with speech in every place it can hide."""
    return draft(
        draft_step(1, 0, 4, "Greet the patient", description="Say hello and explain the procedure."),
        draft_step(2, 4, 10, "Lock the bed brakes", critical=True, prerequisites=[1],
                   pass_criteria=["Both brake pedals are pressed down.", "Caregiver says the brakes are on."],
                   fail_criteria=["A brake pedal is left up."],
                   unverified_when=["The wheels are out of frame.", "The caregiver's speech is inaudible."]),
        draft_step(3, 10, 16, "Lower the patient", critical=True, prerequisites=[2],
                   description="Tell the patient to relax while sliding them down your leg.",
                   visual_cues=["Caregiver counts to three.", "Patient slides down the caregiver's leg."]),
        draft_step(4, 16, 20, "Check on the patient", prerequisites=[3],
                   pass_criteria=["Caregiver asks how the patient feels."]),
        draft_step(5, 20, 26, "Get help", applies_when="the patient says they are in pain", prerequisites=[4]),
        draft_step(6, 26, 32, "Help the patient sit up", prerequisites=[4, 3]),
        safety=("The patient's head never hits the floor.", "Caregiver reassures the patient throughout."),
    )


def _no_speech(rb):
    return (sight.speech_problems(s.model_dump() for s in rb.steps) == []
            and not any(sight.spoken_words(t) for t in rb.safety_criteria))


def test_build_rubric_drops_everything_that_depends_on_speech_and_keeps_ids_and_prerequisites_consistent():
    rb = build_rubric(_speech_draft(), duration=40)
    assert _no_speech(rb)
    # Greet: speech title. Check on the patient: no pass criterion left. Get help: a condition nobody can see.
    assert [s.title for s in rb.steps] == ["Lock the bed brakes", "Lower the patient", "Help the patient sit up"]
    assert [(s.step_id, s.order) for s in rb.steps] == [("s1", 1), ("s2", 2), ("s3", 3)]
    brakes, lower, sit_up = rb.steps
    assert brakes.must_follow == [] and brakes.evals.pass_criteria == ["Both brake pedals are pressed down."]
    assert brakes.evals.unverified_when == ["The wheels are out of frame."]
    assert lower.description == "Lower the patient"  # a spoken description falls back to the title
    assert lower.evals.visual_cues == ["Patient slides down the caregiver's leg."] and lower.must_follow == ["s1"]
    # "Help the patient sit up" needed "Check on the patient" (removed), which needed "Lower the patient".
    assert sit_up.must_follow == ["s2"] and sit_up.order_dependent
    assert rb.safety_criteria == ["The patient's head never hits the floor."]
    assert 'removed the step "Greet the patient"' in rb.notes
    assert 'removed the step "Check on the patient", which had nothing left to judge it by' in rb.notes
    assert 'removed the step "Get help"' in rb.notes
    assert 'dropped "Caregiver says the brakes are on." from "Lock the bed brakes"' in rb.notes
    assert 'dropped the safety point "Caregiver reassures the patient throughout."' in rb.notes
    assert rb.notes.startswith("left out intro Recordings are graded without sound")


def test_removing_a_step_passes_its_prerequisites_on_through_a_chain():
    clean, changes = enforce_sight(draft(
        draft_step(1, 0, 5, "Lock the brakes"),
        draft_step(2, 5, 10, "Explain the transfer", prerequisites=[1]),
        draft_step(3, 10, 15, "Tell the patient to scoot forward", prerequisites=[2]),
        draft_step(4, 15, 20, "Stand the patient", prerequisites=[3, 1]),
    ))
    assert [(s.number, s.prerequisites) for s in clean.steps] == [(1, []), (4, [1])]
    assert len(changes) == 2


def test_enforce_sight_leaves_a_clean_draft_alone_and_keeps_steps_with_no_criteria_to_begin_with():
    d = draft(draft_step(1, 0, 5, "Lock the brakes", pass_criteria=[]), draft_step(2, 5, 9, "Stand"))
    clean, changes = enforce_sight(d)
    assert clean is d and changes == []
    assert build_rubric(d, duration=10).steps[0].evals.pass_criteria  # filled from the description, as before


def test_a_long_list_of_changes_is_cut_short_in_the_notes():
    steps = [draft_step(i, i, i + 1, f"Step {i}", pass_criteria=["Seen.", f"Caregiver says {i}."]) for i in range(1, 13)]
    rb = build_rubric(draft(*steps), duration=20)
    assert rb.notes.count("dropped") == rubric.MAX_NOTED_CHANGES and rb.notes.endswith("and 2 more changes like these.")


# --- sight only: the repair call ---------------------------------------------
def test_speech_pieces_lists_step_and_safety_text_with_ids():
    pieces = rubric.speech_pieces(_speech_draft())
    assert [p["id"] for p in pieces] == [f"p{i + 1}" for i in range(len(pieces))]
    where = [(p["step"], p["field"], p["index"]) for p in pieces]
    assert (1, "title", None) in where and (2, "pass_criteria", 1) in where and (2, "unverified_when", 1) in where
    assert (5, "applies_when", None) in where and (None, "safety_criteria", 1) in where
    assert pieces[0]["where"] == "step 1 title" and pieces[-1]["where"] == "safety point"


def _pieces_by(pieces, step, field, index=None):
    return next(p["id"] for p in pieces if (p["step"], p["field"], p["index"]) == (step, field, index))


def test_run_sends_speech_back_for_a_sight_only_rewrite_before_refining(monkeypatch):
    monkeypatch.setattr(config, "FAKE_AI", False)
    outline = _speech_draft()
    pieces = rubric.speech_pieces(outline)
    fixes = [
        PieceFix(id=_pieces_by(pieces, 2, "pass_criteria", 1), text="Caregiver presses each pedal and tries a wheel."),
        PieceFix(id=_pieces_by(pieces, 2, "unverified_when", 1), text=""),
        PieceFix(id=_pieces_by(pieces, 3, "description"), text="Slide the patient down your leg to the floor."),
        PieceFix(id=_pieces_by(pieces, 3, "visual_cues", 0), text="Caregiver says one, two, three."),  # still speech
        PieceFix(id=_pieces_by(pieces, 4, "pass_criteria", 0), text="Caregiver crouches to look at the patient's face."),
        PieceFix(id=_pieces_by(pieces, 5, "applies_when"), text="the patient cannot get up unaided"),
        PieceFix(id=_pieces_by(pieces, None, "safety_criteria", 1), text="A hand stays on the patient's shoulder."),
        PieceFix(id="p99", text="unknown id is ignored"),
    ]
    reply = SightRepair(remove_steps=[1, 42], fixes=fixes)
    ctx = StubCtx(outline, WindowBounds(steps=[]), sight_reply=reply)
    ctx.duration = 40.0
    rb = rubric.run(ctx, CLASSIFICATION)

    assert [c[0] for c in ctx.calls][:2] == ["rubric_outline", "rubric_sight"]
    assert ctx.calls[1][2]["optional"] is True
    assert [p["type"] for p in ctx.sight_parts] == ["text"]  # text only: the video is not sent again
    assert "Caregiver says the brakes are on." in ctx.sight_parts[0]["text"]
    # Removed steps are not refined: the bounds calls only list the steps that are left.
    bounds_text = " ".join(c[1].get("text", "") for c in ctx.calls if c[0] == "rubric_bounds")
    assert "Greet the patient" not in bounds_text

    assert _no_speech(rb)
    assert [s.title for s in rb.steps] == ["Lock the bed brakes", "Lower the patient", "Check on the patient",
                                           "Get help", "Help the patient sit up"]
    brakes, lower, look, get_help, sit_up = rb.steps
    assert brakes.evals.pass_criteria == ["Both brake pedals are pressed down.",
                                          "Caregiver presses each pedal and tries a wheel."]
    assert brakes.evals.unverified_when == ["The wheels are out of frame."] and brakes.must_follow == []
    assert lower.description == "Slide the patient down your leg to the floor."
    assert lower.evals.visual_cues == ["Patient slides down the caregiver's leg."]
    assert look.evals.pass_criteria == ["Caregiver crouches to look at the patient's face."]
    assert get_help.applies_when == "the patient cannot get up unaided" and get_help.must_follow == ["s3"]
    assert sit_up.must_follow == ["s2", "s3"]
    assert rb.safety_criteria == ["The patient's head never hits the floor.", "A hand stays on the patient's shoulder."]
    assert 'removed the step "Greet the patient"' in rb.notes
    assert 'rewrote "Caregiver asks how the patient feels." as "Caregiver crouches' in rb.notes
    assert 'dropped "Caregiver counts to three." from "Lower the patient"' in rb.notes
    assert any(line.startswith("rubric sight:") for line in ctx.logs)


def test_an_emptied_condition_removes_the_step_rather_than_making_it_always_needed(monkeypatch):
    monkeypatch.setattr(config, "FAKE_AI", False)
    outline = draft(draft_step(1, 0, 10, "Lower the patient"),
                    draft_step(2, 10, 20, "Get help", applies_when="the patient says it hurts"))
    pieces = rubric.speech_pieces(outline)
    ctx = StubCtx(outline, WindowBounds(steps=[]), sight_reply=SightRepair(
        remove_steps=[], fixes=[PieceFix(id=pieces[0]["id"], text="")]))
    rb = rubric.run(ctx, CLASSIFICATION)
    assert [s.title for s in rb.steps] == ["Lower the patient"]


@pytest.mark.parametrize("sight_reply", [
    gemini.SkippedForBudget("rubric_sight skipped: the job has spent its allowance"),
    gemini.GeminiError("the model returned nothing"),
    SightRepair(remove_steps=[], fixes=[PieceFix(id="p1", text="Ask the patient again."),
                                        PieceFix(id="nonsense", text="")]),
])
def test_speech_never_reaches_the_rubric_when_the_repair_is_skipped_or_bad(monkeypatch, sight_reply):
    monkeypatch.setattr(config, "FAKE_AI", False)
    ctx = StubCtx(_speech_draft(), WindowBounds(steps=[]), sight_reply=sight_reply)
    ctx.duration = 40.0
    rb = rubric.run(ctx, CLASSIFICATION)
    assert _no_speech(rb)
    assert [s.title for s in rb.steps] == ["Lock the bed brakes", "Lower the patient", "Help the patient sit up"]
    assert rb.steps[2].must_follow == ["s2"]
    assert "rubric_bounds" in [c[0] for c in ctx.calls]  # the rest of the stage still runs
    assert 'removed the step "Greet the patient"' in rb.notes


def test_a_sight_only_outline_makes_no_repair_call(monkeypatch):
    monkeypatch.setattr(config, "FAKE_AI", False)
    ctx = StubCtx(draft(draft_step(1, 0, 10, "Lock brakes"), draft_step(2, 10, 20, "Stand up")),
                  WindowBounds(steps=[]))
    rb = rubric.run(ctx, CLASSIFICATION)
    assert "rubric_sight" not in [c[0] for c in ctx.calls]
    assert rb.notes == "left out intro"


def test_outline_prompt_asks_for_sight_only_text_and_conditions():
    text = rubric.outline_prompt(CLASSIFICATION, 60)
    assert "WITHOUT SOUND" in text and "Only needed when" in text
    assert "hears the audio" not in text and "Ask the patient about dizziness" not in text
    assert "inaudible" not in text and "words spoken" not in text


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
