"""Hand-written rubrics and ground truth for testing the timeline stage.

The step times were read off one-second contact sheets of the reference videos.
Synthetic attempts are cut from those videos with media.cut, so the true time of
every step in an attempt is known: expected_times() maps the source times through
the cut. Used by tests/test_timeline.py (no Gemini) and scripts/try_timeline.py
(real Gemini).
"""
from __future__ import annotations

from dataclasses import dataclass

from app.models import Rubric, RubricStep, StepEval


def _step(step_id: str, order: int, title: str, description: str, start_s: float, end_s: float, *,
          cues: list[str], must_follow: list[str], critical: bool = False) -> RubricStep:
    return RubricStep(
        step_id=step_id, order=order, title=title, description=description, start_s=start_s, end_s=end_s,
        critical=critical, order_dependent=bool(must_follow), must_follow=must_follow,
        evals=StepEval(
            pass_criteria=[f"The caregiver visibly completes this: {description}"],
            fail_criteria=[f"The step is skipped, rushed or done unsafely: {title.lower()}."],
            unverified_when=["The people or the relevant body parts are out of frame or blocked from view."],
            visual_cues=cues,
        ),
    )


SIT_TO_STAND = Rubric(
    order_matters=True,
    safety_criteria=["The person rises with a forward lean and stays balanced over their feet."],
    steps=[
        _step("s1", 1, "Greet and explain", "Face the seated person, greet them and explain you will help them stand.",
              5.5, 9.0, cues=["caregiver bends toward the seated person and talks to them before any movement"],
              must_follow=[]),
        _step("s2", 2, "Hands on armrests", "Ask the person to place both hands on the chair's armrests.",
              9.0, 13.0, cues=["the seated person moves their hands onto the armrests", "caregiver asks for hands on the armrests"],
              must_follow=["s1"]),
        _step("s3", 3, "Shuffle to the front of the chair", "Have the person wriggle their bottom forward to the front edge of the seat.",
              13.0, 19.5, cues=["the seated person shifts their hips forward on the seat",
                                "caregiver asks them to move to the front of the chair"],
              must_follow=["s2"]),
        _step("s4", 4, "Feet back and apart", "Have the person tuck their feet back under the knees, hip-width apart.",
              19.5, 26.0, cues=["caregiver points to or guides the person's feet", "feet slide back under the knees"],
              must_follow=["s3"], critical=True),
        _step("s5", 5, "Hand placement and head up", "Place a hand on the person's back and ask them to keep their head up and look forward.",
              26.0, 36.0, cues=["caregiver's hand goes behind the person's back or shoulder",
                                "caregiver asks the person to look ahead"],
              must_follow=["s4"]),
        _step("s6", 6, "Rock and stand on the count", "Count 'ready, steady, stand' while the person rocks forward and rises with support.",
              36.0, 47.0, cues=["verbal count 'ready, steady, stand'", "the person leans forward and rises to standing"],
              must_follow=["s2", "s3", "s4", "s5"], critical=True),
        _step("s7", 7, "Check balance once standing", "Stay close while the person stands upright and confirm they are steady.",
              47.0, 49.8, cues=["both people stand upright, caregiver's hand still on the person", "caregiver praises or checks on them"],
              must_follow=["s6"]),
    ],
)

FALL_RESPONSE = Rubric(
    order_matters=True,
    safety_criteria=["The person's head is protected and they are lowered, never dropped."],
    steps=[
        _step("s1", 1, "Help the person up from the bed", "Help the person sit on the edge of the bed and then stand.",
              2.0, 20.0, cues=["person moves from lying to sitting on the bed edge", "caregiver supports them as they stand"],
              must_follow=[]),
        _step("s2", 2, "Walk with close support", "Walk just behind and to the side of the person with hands on their waist or belt.",
              20.0, 33.0, cues=["the two walk together, caregiver close behind with hands at the person's waist"],
              must_follow=["s1"]),
        _step("s3", 3, "Recognise the fall and pull close", "When the person's knees buckle, step in, widen your stance and pull them against your body.",
              33.0, 39.0, cues=["person's legs give way", "caregiver steps in and holds the person against their body"],
              must_follow=["s2"], critical=True),
        _step("s4", 4, "Lower to the floor", "Slide the person down your leg to the floor while bending your knees, keeping their head protected.",
              39.0, 47.0, cues=["caregiver kneels or squats while guiding the person down", "person ends up sitting on the floor"],
              must_follow=["s3"], critical=True),
        _step("s5", 5, "Stay and reassure", "Stay with the person on the floor, reassure them and check for injury.",
              47.0, 64.0, cues=["caregiver kneels beside the person with a hand on their shoulder and talks to them"],
              must_follow=["s4"]),
        _step("s6", 6, "Call for help", "Reach for the call light or call out for help without leaving the person.",
              64.0, 71.0, cues=["caregiver reaches for the call button or calls out", "caregiver stays next to the person"],
              must_follow=["s4"]),
    ],
)


@dataclass(frozen=True)
class Case:
    """One synthetic attempt: segments of a source video joined in order."""

    name: str
    source: str
    rubric: Rubric
    segments: list[tuple[float, float]]
    truth: dict[str, tuple[float, float]] | None = None  # step times in the source video; None = no ground truth
    expect_violations: tuple[tuple[str, str], ...] = ()  # (step_id, expected_after)
    expect_missing: tuple[str, ...] = ()


def _truth(rubric: Rubric) -> dict[str, tuple[float, float]]:
    return {s.step_id: (s.start_s, s.end_s) for s in rubric.steps}


STS = "sittostand_primary.mp4"
FALL = "Fall Response Primary.mp4"

CASES: list[Case] = [
    Case("sts_original", STS, SIT_TO_STAND, [(5.0, 50.0)], _truth(SIT_TO_STAND)),
    Case("sts_swap_s3_s4", STS, SIT_TO_STAND, [(5.0, 13.0), (19.5, 26.0), (13.0, 19.5), (26.0, 50.0)],
         _truth(SIT_TO_STAND), expect_violations=(("s4", "s3"),)),
    Case("sts_without_s4", STS, SIT_TO_STAND, [(5.0, 19.5), (26.0, 50.0)], _truth(SIT_TO_STAND),
         expect_missing=("s4",)),
    Case("fall_original", FALL, FALL_RESPONSE, [(1.5, 71.5)], _truth(FALL_RESPONSE)),
    Case("fall_swap_s1_s2", FALL, FALL_RESPONSE, [(20.0, 33.0), (1.5, 20.0), (33.0, 71.5)], _truth(FALL_RESPONSE),
         expect_violations=(("s2", "s1"),)),
    Case("fall_without_s6", FALL, FALL_RESPONSE, [(1.5, 61.0)], _truth(FALL_RESPONSE), expect_missing=("s6",)),
    # Same skill, different people and room: a staged controlled fall, no bed and no walk.
    Case("fall_backup", "Fall Response Backup.mp4", FALL_RESPONSE, [], None),
    # A different skill altogether: no sit-to-stand step should be found.
    Case("glove_vs_sts", "Glove Removal Primary.mp4", SIT_TO_STAND, [], None,
         expect_missing=("s1", "s2", "s3", "s4", "s5", "s6", "s7")),
]

BY_NAME = {c.name: c for c in CASES}


def expected_times(segments: list[tuple[float, float]], truth: dict[str, tuple[float, float]],
                   min_overlap: float = 1.0) -> dict[str, tuple[float, float] | None]:
    """Where each step lands in a video cut from segments of the source.

    A step is present when at least min_overlap seconds of it survive the cut; its
    time is the span of the surviving pieces. None means the step was cut out."""
    out: dict[str, tuple[float, float] | None] = {}
    for step_id, (a, b) in truth.items():
        pieces, offset = [], 0.0
        for seg_a, seg_b in segments:
            lo, hi = max(a, seg_a), min(b, seg_b)
            if hi - lo >= min_overlap:
                pieces.append((offset + lo - seg_a, offset + hi - seg_a))
            offset += seg_b - seg_a
        out[step_id] = (min(p[0] for p in pieces), max(p[1] for p in pieces)) if pieces else None
    return out
