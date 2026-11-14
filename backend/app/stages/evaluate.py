"""Stage: evaluate. Grade each step of a caregiver's attempt against the rubric's evals,
identify the people, flag patient-safety problems, and double-check unclear steps.

  run(ctx, rubric, timeline) -> Evaluation
      One Gemini pass over the whole attempt, then a closer second look (model "strong",
      higher frame rate and resolution, just the step's clip) at every step that came back
      unverified, below MIN_CONFIDENCE, or failed while critical.
  confirm_pose_flags(ctx, rubric, flags) -> list[SafetyFlag]
      Pose readings are noisy, so a pose-derived flag only counts once Gemini sees the
      same problem on the clip around it.

Owned by branch feat/evaluate.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel, Field

from .. import config
from ..models import (
    Evaluation, FlagKind, PersonObs, Rubric, RubricStep, SafetyFlag, Severity, Status, StepResult, Timeline,
)
from . import _fake
from . import evaluate_prompts as prompts

MIN_CONFIDENCE = 0.7          # below this a step gets a second look
MAX_DOUBLE_CHECKS = 6         # per attempt, to bound cost and latency
MAX_FLAG_CHECKS = 3           # pose candidates confirmed per attempt
CLIP_PAD_S = 3.0              # seconds added either side of a step's time range
FLAG_PAD_S = 2.0              # seconds added either side of a pose flag
SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


# --- what Gemini returns ----------------------------------------------------
# Times and confidence are whole numbers here: with float fields the model has been seen
# to emit a number with tens of thousands of digits, which costs a lot and fails to parse.
# Timestamps come back at one-second precision anyway.
class StepJudgement(BaseModel):
    """One graded step. Evidence comes before the verdict so the model describes first."""

    step_id: str
    evidence: str = Field(description="what was actually seen or heard")
    evidence_start_s: int = Field(description="whole seconds from the start of the video")
    evidence_end_s: int = Field(description="whole seconds from the start of the video")
    status: Status
    confidence_pct: int = Field(description="0 to 100: how sure you are of the status")
    feedback: str = Field(description="one or two sentences to the caregiver")


class FlagObservation(BaseModel):
    kind: FlagKind
    severity: Severity
    start_s: int = Field(description="whole seconds from the start of the video")
    end_s: int | None = Field(default=None, description="whole seconds from the start of the video")
    person_label: str | None = None
    description: str


class GradeReply(BaseModel):
    people: list[PersonObs]
    skill_match: bool
    skill_match_note: str = Field(default="", description="what the video shows instead, when it is not this skill")
    steps: list[StepJudgement]
    safety_flags: list[FlagObservation] = Field(default_factory=list)
    overall_feedback: str


class FlagCheckReply(BaseModel):
    observed: bool
    kind: FlagKind = "other"
    severity: Severity = "low"
    start_s: int | None = Field(default=None, description="whole seconds from the start of the video")
    end_s: int | None = Field(default=None, description="whole seconds from the start of the video")
    description: str = ""


# --- stage entry points ------------------------------------------------------
def run(ctx, rubric: Rubric, timeline: Timeline) -> Evaluation:
    """Grade the attempt, then double-check unclear steps on their own clips
    (skipped when the video does not show the skill)."""
    if config.FAKE_AI:
        return _fake.evaluation(ctx, rubric, timeline)
    skill = ctx.skill or {}
    reply = ctx.generate_json(
        "evaluate",
        [ctx.video_part(resolution="medium"),
         {"type": "text", "text": prompts.grade_prompt(skill, rubric, timeline, ctx.duration)}],
        GradeReply, model="main", thinking="medium",
    )
    evaluation = build_evaluation(reply, rubric, ctx.duration)
    if evaluation.skill_match:  # steps of a different skill are not worth a closer look
        _double_check(ctx, rubric, timeline, evaluation)
    return evaluation


def confirm_pose_flags(ctx, rubric: Rubric, flags: list[SafetyFlag]) -> list[SafetyFlag]:
    """Ask Gemini to confirm the most severe pose candidates on their clips.

    Up to MAX_FLAG_CHECKS candidates, most severe first, are checked. A confirmed flag comes
    back with source "pose_confirmed", counts_toward_score True, Gemini's severity and a
    description of what was seen. Every other flag is returned unchanged, in the same order."""
    if config.FAKE_AI or not flags:
        return list(flags)
    ranked = sorted(range(len(flags)), key=lambda i: (SEVERITY_RANK.get(flags[i].severity, 3), flags[i].start_s))
    to_check = [i for i in ranked if flags[i].source == "pose"][:MAX_FLAG_CHECKS]
    result = list(flags)
    with ThreadPoolExecutor(max_workers=len(to_check) or 1, thread_name_prefix="confirm") as pool:
        futures = {i: pool.submit(_confirm_one, ctx, rubric, flags[i]) for i in to_check}
    for i, future in futures.items():
        try:
            result[i] = future.result()
        except Exception as exc:  # a failed check leaves the flag advisory
            ctx.log(f"confirm flag at {flags[i].start_s:.1f}s failed: {type(exc).__name__}: {exc}")
    return result


# --- validation ----------------------------------------------------------------
def _clamp_time(t: float | None, duration: float) -> float | None:
    if t is None:
        return None
    t = max(0.0, float(t))
    return min(t, duration) if duration > 0 else t


def _clamp_span(start: float | None, end: float | None, duration: float) -> tuple[float | None, float | None]:
    start, end = _clamp_time(start, duration), _clamp_time(end, duration)
    if start is not None and end is not None and end < start:
        start, end = end, start
    return start, end


def to_step_result(j: StepJudgement, duration: float, double_checked: bool = False) -> StepResult:
    """A model judgement as a StepResult with times and confidence clamped."""
    start, end = _clamp_span(j.evidence_start_s, j.evidence_end_s, duration)
    return StepResult(
        step_id=j.step_id, status=j.status, confidence=round(min(1.0, max(0.0, j.confidence_pct / 100)), 2),
        feedback=j.feedback.strip(), evidence=j.evidence.strip(), evidence_start_s=start, evidence_end_s=end,
        double_checked=double_checked,
    )


def missing_result(step: RubricStep) -> StepResult:
    """Placeholder for a step the model did not grade: unverified, so a nurse looks at it."""
    return StepResult(
        step_id=step.step_id, status="unverified", confidence=0.0,
        feedback=f'We could not assess "{step.title}" from this recording. '
                 "Record it again with the whole movement in view of the camera.",
        evidence="The assessment did not return a result for this step.",
    )


def build_evaluation(reply: GradeReply, rubric: Rubric, duration: float) -> Evaluation:
    """Turn the model's reply into an Evaluation with exactly one result per rubric step,
    in rubric order. Unknown step ids are dropped, duplicates keep the first, omitted steps
    become unverified, and every time and confidence is clamped."""
    steps = sorted(rubric.steps, key=lambda s: s.order)
    judged: dict[str, StepJudgement] = {}
    for j in reply.steps:
        judged.setdefault(j.step_id.strip(), j)
    results = [to_step_result(judged[s.step_id], duration) if s.step_id in judged else missing_result(s)
               for s in steps]

    people: list[PersonObs] = []
    for p in reply.people:
        label = p.label.strip() or f"P{len(people) + 1}"
        if all(q.label != label for q in people):
            people.append(PersonObs(label=label, role=p.role, description=p.description.strip()))
    labels = {p.label for p in people}

    flags = []
    for f in reply.safety_flags:
        start, end = _clamp_span(f.start_s, f.end_s, duration)
        flags.append(SafetyFlag(
            kind=f.kind, severity=f.severity, start_s=start or 0.0, end_s=end,
            person_label=f.person_label if f.person_label in labels else None,
            description=f.description.strip(), source="gemini", counts_toward_score=True,
        ))
    flags.sort(key=lambda f: f.start_s)

    return Evaluation(
        people=people, steps=results, safety_flags=flags, overall_feedback=reply.overall_feedback.strip(),
        skill_match=reply.skill_match, skill_match_note=reply.skill_match_note.strip() if not reply.skill_match else "",
    )


# --- double-check ----------------------------------------------------------------
def needs_double_check(result: StepResult, step: RubricStep) -> bool:
    return (result.status == "unverified" or result.confidence < MIN_CONFIDENCE
            or (result.status == "failed" and step.critical))


def pick_double_checks(rubric: Rubric, evaluation: Evaluation) -> list[str]:
    """Step ids to look at again, most important first, at most MAX_DOUBLE_CHECKS:
    failed critical steps, then other critical steps, then the rest, least confident first."""
    steps = {s.step_id: s for s in rubric.steps}
    candidates = [r for r in evaluation.steps if r.step_id in steps and needs_double_check(r, steps[r.step_id])]
    candidates.sort(key=lambda r: (
        not (r.status == "failed" and steps[r.step_id].critical), not steps[r.step_id].critical, r.confidence,
    ))
    return [r.step_id for r in candidates[:MAX_DOUBLE_CHECKS]]


def step_window(step_id: str, rubric: Rubric, timeline: Timeline, result: StepResult | None,
                duration: float) -> tuple[float, float]:
    """The clip to re-examine for a step, padded by CLIP_PAD_S.

    Uses the timeline's range when the step was located, else the first pass's evidence
    times, else the gap between the nearest located neighbours in rubric order (the whole
    video when there are none, or when the neighbours are out of order)."""
    end_cap = duration if duration > 0 else float("inf")
    located = {t.step_id: t for t in timeline.steps if t.found and t.start_s is not None}
    t = located.get(step_id)
    if t is not None:
        lo, hi = t.start_s, t.end_s if t.end_s is not None else t.start_s
    elif result is not None and result.evidence_start_s is not None:
        lo = result.evidence_start_s
        hi = result.evidence_end_s if result.evidence_end_s is not None else lo
    else:
        order = [s.step_id for s in sorted(rubric.steps, key=lambda s: s.order)]
        idx = order.index(step_id) if step_id in order else 0
        before = [located[i] for i in order[:idx] if i in located]
        after = [located[i] for i in order[idx + 1:] if i in located]
        lo = max((b.end_s if b.end_s is not None else b.start_s) for b in before) if before else 0.0
        hi = min(a.start_s for a in after) if after else end_cap
        if hi <= lo:
            lo, hi = 0.0, end_cap
    lo = max(0.0, lo - CLIP_PAD_S)
    hi = min(end_cap, hi + CLIP_PAD_S)
    if hi == float("inf"):
        hi = lo + 60.0
    return round(lo, 1), round(max(hi, lo + 1.0), 1)


def clip_sampling(length_s: float) -> float:
    """Frames per second for a second look: dense on short clips, lighter on long ones."""
    if length_s <= 20:
        return 3.0
    if length_s <= 45:
        return 2.0
    return 1.5


def _double_check_one(ctx, step: RubricStep, start: float, end: float) -> StepResult:
    j = ctx.generate_json(
        f"evaluate_double_check:{step.step_id}",
        [ctx.video_part(resolution="high", start_s=start, end_s=end, fps=clip_sampling(end - start)),
         {"type": "text", "text": prompts.double_check_prompt(ctx.skill or {}, step, start, end, ctx.duration)}],
        # thinking "medium" on an ambiguous clip has used 20k thought tokens (about $0.40 a step)
        StepJudgement, model="strong", thinking="low",
    )
    j.step_id = step.step_id
    return to_step_result(j, ctx.duration, double_checked=True)


def _double_check(ctx, rubric: Rubric, timeline: Timeline, evaluation: Evaluation) -> None:
    """Re-grade the picked steps concurrently and replace their results in place.
    A step whose second look fails keeps its first result."""
    picked = pick_double_checks(rubric, evaluation)
    if not picked:
        return
    steps = {s.step_id: s for s in rubric.steps}
    index = {r.step_id: i for i, r in enumerate(evaluation.steps)}
    with ThreadPoolExecutor(max_workers=len(picked), thread_name_prefix="double_check") as pool:
        futures = {}
        for step_id in picked:
            start, end = step_window(step_id, rubric, timeline, evaluation.steps[index[step_id]], ctx.duration)
            futures[step_id] = pool.submit(_double_check_one, ctx, steps[step_id], start, end)
    for step_id, future in futures.items():
        before = evaluation.steps[index[step_id]]
        try:
            after = future.result()
        except Exception as exc:
            ctx.log(f"double-check of {step_id} failed, keeping first result: {type(exc).__name__}: {exc}")
            continue
        evaluation.steps[index[step_id]] = after
        ctx.log(f"double-check {step_id}: {before.status} ({before.confidence}) -> {after.status} ({after.confidence})")


# --- pose flag confirmation ----------------------------------------------------
def _confirm_one(ctx, rubric: Rubric, flag: SafetyFlag) -> SafetyFlag:
    end_cap = ctx.duration if ctx.duration > 0 else float("inf")
    start = max(0.0, flag.start_s - FLAG_PAD_S)
    end = min(end_cap, (flag.end_s if flag.end_s is not None else flag.start_s) + FLAG_PAD_S)
    end = max(end, start + 1.0)
    reply = ctx.generate_json(
        "evaluate_confirm_flag",
        [ctx.video_part(resolution="medium", start_s=start, end_s=end, fps=2),
         {"type": "text", "text": prompts.confirm_flag_prompt(ctx.skill or {}, flag, start, end, ctx.duration,
                                                              rubric.safety_criteria)}],
        FlagCheckReply, model="main", thinking="low",
    )
    if not reply.observed:
        return flag
    seen_start, seen_end = _clamp_span(reply.start_s, reply.end_s, ctx.duration)
    return flag.model_copy(update={
        "kind": reply.kind if reply.kind != "other" else flag.kind,
        "severity": reply.severity,
        "start_s": seen_start if seen_start is not None else flag.start_s,
        "end_s": seen_end if seen_end is not None else flag.end_s,
        "description": reply.description.strip() or flag.description,
        "source": "pose_confirmed",
        "counts_toward_score": True,
    })
