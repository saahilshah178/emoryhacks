"""Canned stage outputs. Used when FIRSTSHIFT_FAKE_AI=1 (no Gemini calls, no cost) and
as the placeholder behaviour of any stage that has not been implemented yet.
The shapes here are valid examples of every contract in app/models.py."""
from __future__ import annotations

import math

from .. import repo
from ..models import (
    Classification, Evaluation, OrderViolation, PersonObs, PoseSummary, Rubric, RubricStep, SafetyFlag,
    StepEval, StepResult, Timeline, TimelineStep,
)

PEOPLE = [
    PersonObs(label="P1", role="caregiver", description="Standing adult in dark scrubs who guides the movement"),
    PersonObs(label="P2", role="patient", description="Seated older adult in a light top who is being assisted"),
]

_STEPS = [
    ("Prepare and explain", "Position yourself in front of the person and explain what will happen.", False),
    ("Position feet and hands", "Feet flat and under the knees; hands on the armrests or thighs.", True),
    ("Assist to stand", "Cue the person to lean forward and rise, supporting at the waist.", True),
    ("Check balance", "Pause upright and confirm the person is steady before moving on.", False),
]


def classification(ctx) -> Classification:
    slug = ctx.slug_hint or "sit_to_stand"
    return Classification(
        skill_slug=slug, skill_name=slug.replace("_", " ").capitalize(), category="transfer", confidence=0.5,
        summary="Placeholder classification (fake AI mode).", people=PEOPLE, order_matters=True, alternatives=[],
    )


def rubric(ctx, classification=None) -> Rubric:
    duration = max(ctx.duration, 8.0)
    span = duration / len(_STEPS)
    steps = []
    for i, (title, description, critical) in enumerate(_STEPS):
        steps.append(RubricStep(
            step_id=f"s{i + 1}", order=i + 1, title=title, description=description,
            start_s=round(i * span, 1), end_s=round((i + 1) * span, 1), critical=critical,
            order_dependent=True, must_follow=[f"s{i}"] if i else [],
            evals=StepEval(
                pass_criteria=[f"The caregiver visibly completes: {title.lower()}."],
                fail_criteria=[f"The step is skipped or done unsafely: {title.lower()}."],
                unverified_when=["The relevant body parts are out of frame or blocked from view."],
                visual_cues=[description],
            ),
        ))
    return Rubric(steps=steps, safety_criteria=["The person stays upright and centred over their feet."],
                  order_matters=True, notes="Placeholder rubric (fake AI mode).")


def _not_needed(step: RubricStep) -> bool:
    """In fake AI mode a step with an applies_when condition is never needed: its situation
    does not come up, so it is not performed and comes back not_applicable. A test that wants
    a "not needed" result gives a step a condition."""
    return bool(step.applies_when.strip())


def timeline(ctx, rubric: Rubric) -> Timeline:
    """Every step is performed, in turn, except those not needed (_not_needed), with the second
    and third performed steps swapped so the order check has something to show."""
    duration = max(ctx.duration, 8.0)
    performed = [s for s in rubric.steps if not _not_needed(s)]
    n = max(len(performed), 1)
    span = duration / n
    steps, violations = [], []
    order = list(range(len(performed)))
    if len(order) >= 3:  # perform step 3 before step 2 so the order check has something to show
        order[1], order[2] = order[2], order[1]
    for slot, idx in enumerate(order):
        s = performed[idx]
        steps.append(TimelineStep(step_id=s.step_id, found=True, start_s=round(slot * span, 1),
                                  end_s=round((slot + 1) * span, 1), performed_index=slot + 1, confidence=0.6,
                                  note="Placeholder timing (fake AI mode)."))
    if len(order) >= 3:
        early, late = performed[2], performed[1]
        violations.append(OrderViolation(step_id=early.step_id, expected_after=late.step_id,
                                         message=f'"{early.title}" was performed before "{late.title}".',
                                         at_s=round(span, 1)))
    steps += [TimelineStep(step_id=s.step_id, found=False, note="Not needed in this recording (fake AI mode).")
              for s in rubric.steps if _not_needed(s)]
    steps.sort(key=lambda t: [s.step_id for s in rubric.steps].index(t.step_id))
    return Timeline(steps=steps, order_violations=violations, missing_step_ids=[])


def evaluation(ctx, rubric: Rubric, tl: Timeline) -> Evaluation:
    """Statuses cycle passed, failed, unverified, passed by the step's place in the rubric;
    a step with an applies_when condition is not_applicable (_not_needed)."""
    cycle = ["passed", "failed", "unverified", "passed"]
    by_id = {t.step_id: t for t in tl.steps}
    results = []
    for i, s in enumerate(rubric.steps):
        t = by_id.get(s.step_id)
        status = "not_applicable" if _not_needed(s) else cycle[i % len(cycle)]
        seen = t is not None and t.found
        results.append(StepResult(
            step_id=s.step_id, status=status, confidence=0.6,
            feedback={"passed": "Done correctly.", "failed": "This step did not meet the criteria.",
                      "unverified": "The camera could not show this clearly.",
                      "not_applicable": "This step was not needed this time."}[status],
            evidence="Placeholder evidence (fake AI mode).",
            evidence_start_s=t.start_s if seen else None, evidence_end_s=t.end_s if seen else None,
        ))
    flags = [SafetyFlag(kind="patient_off_center", severity="medium", start_s=round(max(ctx.duration, 8.0) * 0.6, 1),
                        end_s=round(max(ctx.duration, 8.0) * 0.7, 1), person_label="P2",
                        description="The person leans to one side while rising.", source="gemini",
                        counts_toward_score=True)]
    return Evaluation(people=PEOPLE, steps=results, safety_flags=flags,
                      overall_feedback="Placeholder feedback (fake AI mode).", skill_match=True, skill_match_note="")


def pose(ctx) -> PoseSummary:
    """Write a synthetic, plausible-looking series for two people so the dashboard has data."""
    duration = min(max(ctx.duration, 8.0), 120.0)
    fps = 5.0
    rows = []
    for person in (0, 1):
        for i in range(int(duration * fps)):
            t = i / fps
            wave = math.sin(t / 3 + person)
            offset = 0.25 * wave + (0.5 if person == 1 and 0.55 * duration < t < 0.7 * duration else 0.0)
            rows.append({
                "person_idx": person, "t_offset": t, "segment_id": 0, "valid": True, "visibility": 0.9,
                "bbox_x0": 0.1 + 0.4 * person, "bbox_y0": 0.1, "bbox_x1": 0.4 + 0.4 * person, "bbox_y1": 0.95,
                "l_elbow": 150 + 20 * wave, "r_elbow": 148 + 22 * wave, "l_shoulder": 30 + 15 * wave,
                "r_shoulder": 32 + 14 * wave, "l_hip": 150 - 40 * abs(wave), "r_hip": 152 - 38 * abs(wave),
                "l_knee": 165 - 60 * abs(wave), "r_knee": 163 - 58 * abs(wave), "l_ankle": 95, "r_ankle": 96,
                "trunk_tilt": 8 + 14 * abs(wave) + (10 if person == 0 else 0), "trunk_lateral": 4 * wave,
                "com_x": 0.25 + 0.4 * person + 0.02 * wave, "com_y": 0.55, "bos_center_x": 0.25 + 0.4 * person,
                "bos_width": 0.12, "com_offset": offset, "sway_velocity": abs(0.05 * math.cos(t / 3)),
                "balance_score": 1 - min(1.0, abs(offset)),
            })
    tracks = [
        {"person_idx": 0, "segment_id": 0, "role": "caregiver", "first_t": 0, "last_t": duration,
         "n_frames": int(duration * fps), "mean_visibility": 0.9},
        {"person_idx": 1, "segment_id": 0, "role": "patient", "first_t": 0, "last_t": duration,
         "n_frames": int(duration * fps), "mean_visibility": 0.9},
    ]
    n = repo.replace_pose(ctx.video_id, ctx.video["recorded_at"], rows, tracks)
    flags = [SafetyFlag(kind="patient_off_center", severity="medium", start_s=round(0.55 * duration, 1),
                        end_s=round(0.7 * duration, 1), person_label="P2",
                        description="Pose readings show the centre of mass outside the base of support.",
                        source="pose", counts_toward_score=False)]
    return PoseSummary(frames_written=n, tracks=2, segments=1, sample_fps=fps, candidate_flags=flags,
                       note="Synthetic pose data (fake AI mode).")
