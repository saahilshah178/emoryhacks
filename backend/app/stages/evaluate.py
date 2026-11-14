"""Stage: evaluate. Grade each step of a caregiver's attempt against the rubric's evals,
identify the people, flag patient-safety problems, and double-check unclear steps.

  run(ctx, rubric, timeline) -> Evaluation
      The grading comes from the same whole-video Gemini call that located the steps
      (assess.assess; the timeline stage made it, so no new call is needed here). Then a
      closer second look (main model, a denser clip of just the step) at up to
      MAX_DOUBLE_CHECKS steps that came back unverified, below MIN_CONFIDENCE, or failed while
      critical, as optional spending: only as many as fit in the job's allowance, keeping
      RESERVE_USD for the later stages. A step the recording stopped before is failed in code
      (see apply_recording_end) rather than re-examined.
  confirm_pose_flags(ctx, rubric, flags) -> list[SafetyFlag]
      Pose readings are noisy, so a pose-derived flag only counts once Gemini sees the
      same problem on the clip around it (optional spending too).

Owned by branch feat/evaluate.
"""
from __future__ import annotations

from collections.abc import Collection
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel, Field

from .. import config, gemini
from ..models import (
    Evaluation, FlagKind, PersonObs, Rubric, RubricStep, SafetyFlag, Severity, Status, StepResult, Timeline,
)
from . import _budget, _fake, assess
from . import evaluate_prompts as prompts
from .assess import FlagObservation

MIN_CONFIDENCE = 0.7          # below this a step gets a second look
CONFIDENT_UNSEEN = 0.85       # an unverified step at least this sure it could not be seen gets none
MAX_DOUBLE_CHECKS = 3         # per attempt, to bound cost and latency
MAX_FLAG_CHECKS = 3           # pose candidates confirmed per attempt
CLIP_PAD_S = 3.0              # seconds added either side of a step's time range
MAX_CLIP_S = 60.0             # a step's clip takes in first-pass evidence only up to this length
WHOLE_VIDEO_FPS = 1.0         # frame rate when a second look has to watch the whole video
RECORDING_END_SLACK_S = 4.0   # located steps ending this close to the end mean the recording stopped there
FLAG_PAD_S = 2.0              # seconds added either side of a pose flag
DOUBLE_CHECK_MAX_TOKENS = 4000  # thinking plus reply for one second look
DOUBLE_CHECK_EXPECTED_TOKENS = 1200
RESERVE_USD = 0.02            # left in the allowance by the second looks, for roles and flag checks
SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


# --- what Gemini returns ----------------------------------------------------
# Times and confidence are whole numbers here: with float fields the model has been seen
# to emit a number with tens of thousands of digits, which costs a lot and fails to parse.
# Timestamps come back at one-second precision anyway.
class StepJudgement(BaseModel):
    """One graded step. Evidence comes before the verdict so the model describes first."""

    step_id: str
    evidence: str = Field(description="what was actually seen or heard")
    # No default, so the schema keeps them required; null says the step was not seen at all.
    evidence_start_s: int | None = Field(description="whole seconds from the start of the video; null when not seen")
    evidence_end_s: int | None = Field(description="whole seconds from the start of the video; null when not seen")
    status: Status
    confidence_pct: int = Field(description="0 to 100: how sure you are of the status")
    feedback: str = Field(description="one or two sentences to the caregiver")


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
    # Required, so a confirmed flag is described in Gemini's words rather than the tracker's.
    description: str = Field(description="one sentence on what you saw; empty when not observed")


# --- stage entry points ------------------------------------------------------
def grade_reply_from(reply: assess.AssessReply) -> GradeReply:
    """The grading half of the whole-video reply. The span a step was located at is its evidence span."""
    return GradeReply(
        people=reply.people, skill_match=reply.skill_match, skill_match_note=reply.skill_match_note,
        steps=[StepJudgement(step_id=s.step_id, evidence=s.evidence, evidence_start_s=s.start_s,
                             evidence_end_s=s.end_s if s.start_s is not None else None, status=s.status,
                             confidence_pct=s.confidence_pct, feedback=s.feedback) for s in reply.steps],
        safety_flags=reply.safety_flags, overall_feedback=reply.overall_feedback,
    )


def run(ctx, rubric: Rubric, timeline: Timeline) -> Evaluation:
    """Grade the attempt, then double-check unclear steps on their own clips
    (skipped when the video does not show the skill)."""
    if config.FAKE_AI:
        return _fake.evaluation(ctx, rubric, timeline)
    evaluation = build_evaluation(grade_reply_from(assess.assess(ctx, rubric)), rubric, ctx.duration)
    if not evaluation.skill_match:  # steps of a different skill are not worth a closer look
        return evaluation
    not_reached = apply_recording_end(rubric, timeline, evaluation, ctx.duration)
    rechecked = _double_check(ctx, rubric, timeline, evaluation,
                              skip=settled_by_recording_end(rubric, timeline, evaluation, ctx.duration))
    if not_reached or rechecked:
        evaluation.overall_feedback = _rewrite_feedback(ctx, rubric, timeline, evaluation)
    return evaluation


def confirm_pose_flags(ctx, rubric: Rubric, flags: list[SafetyFlag]) -> list[SafetyFlag]:
    """Ask Gemini to confirm the most severe pose candidates on their clips.

    Up to MAX_FLAG_CHECKS candidates, most severe first, are checked, as many as fit in the
    job's allowance. A confirmed flag comes back with source "pose_confirmed",
    counts_toward_score True, Gemini's severity and a description of what was seen. Every
    other flag is returned unchanged, in the same order."""
    if config.FAKE_AI or not flags:
        return list(flags)
    ranked = sorted(range(len(flags)), key=lambda i: (SEVERITY_RANK.get(flags[i].severity, 3), flags[i].start_s))
    to_check = [i for i in ranked if flags[i].source == "pose"][:MAX_FLAG_CHECKS]
    estimates = [_budget.clip_estimate(ctx, *flag_clip(flags[i], ctx.duration), 2, "medium", 2500, 500)
                 for i in to_check]
    fit = _budget.how_many_fit(ctx, estimates)
    if fit < len(to_check):
        ctx.log(f"confirm flags: {len(to_check) - fit} of {len(to_check)} not checked, the job's allowance is used up")
    to_check = to_check[:fit]
    result = list(flags)
    if not to_check:
        return result
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


def steps_after_recording_end(rubric: Rubric, timeline: Timeline, duration: float) -> list[str]:
    """Steps the recording stopped before: every step after the last one the timeline located
    (in rubric order), provided the located steps run to within RECORDING_END_SLACK_S of the
    end of the video. Empty when nothing was located or the duration is unknown."""
    located = [t for t in timeline.steps if t.found and t.start_s is not None]
    order = [s.step_id for s in sorted(rubric.steps, key=lambda s: s.order)]
    positions = [order.index(t.step_id) for t in located if t.step_id in order]
    if duration <= 0 or not positions:
        return []
    last_end = max(t.end_s if t.end_s is not None else t.start_s for t in located)
    if last_end < duration - RECORDING_END_SLACK_S:
        return []
    return order[max(positions) + 1:]


def apply_recording_end(rubric: Rubric, timeline: Timeline, evaluation: Evaluation, duration: float) -> list[str]:
    """A step not performed in this attempt is failed, and that includes a recording that
    stops before it; unverified is only for a step that may have happened out of view. So an
    unverified step the recording stopped before (see steps_after_recording_end) becomes
    failed. Changes evaluation in place and returns the ids it changed."""
    titles = {s.step_id: s.title for s in rubric.steps}
    tail = set(steps_after_recording_end(rubric, timeline, duration))
    changed = []
    for i, r in enumerate(evaluation.steps):
        if r.step_id in tail and r.status == "unverified":
            evaluation.steps[i] = r.model_copy(update={
                "status": "failed", "confidence": 0.9, "evidence_start_s": None, "evidence_end_s": None,
                "evidence": "The recording ends before this step.",
                "feedback": f'The recording stopped before you did "{titles[r.step_id]}". '
                            "Keep recording until you have finished every step.",
            })
            changed.append(r.step_id)
    return changed


def settled_by_recording_end(rubric: Rubric, timeline: Timeline, evaluation: Evaluation,
                             duration: float) -> set[str]:
    """Steps the recording stopped before that are failed with nothing seen: a second look at
    the last seconds of the video cannot change them, so they are not double-checked."""
    tail = set(steps_after_recording_end(rubric, timeline, duration))
    return {r.step_id for r in evaluation.steps
            if r.step_id in tail and r.status == "failed" and r.evidence_start_s is None}


# --- double-check ----------------------------------------------------------------
def needs_double_check(result: StepResult, step: RubricStep) -> bool:
    """Unclear steps: low confidence, unverified (unless the first look was sure it could not be
    seen, as when it is out of frame), or failed while critical. A second look at a step the
    first look was sure it could not see has been seen to invent a pass for it."""
    return ((result.status == "unverified" and result.confidence < CONFIDENT_UNSEEN)
            or result.confidence < MIN_CONFIDENCE or (result.status == "failed" and step.critical))


def pick_double_checks(rubric: Rubric, evaluation: Evaluation, skip: Collection[str] = ()) -> list[str]:
    """Step ids to look at again, most important first, at most MAX_DOUBLE_CHECKS:
    failed critical steps, then other critical steps, then the rest, least confident first.
    Steps in skip are already settled and never picked."""
    steps = {s.step_id: s for s in rubric.steps}
    candidates = [r for r in evaluation.steps
                  if r.step_id in steps and r.step_id not in skip and needs_double_check(r, steps[r.step_id])]
    candidates.sort(key=lambda r: (
        not (r.status == "failed" and steps[r.step_id].critical), not steps[r.step_id].critical, r.confidence,
    ))
    return [r.step_id for r in candidates[:MAX_DOUBLE_CHECKS]]


def step_window(step_id: str, rubric: Rubric, timeline: Timeline, result: StepResult | None,
                duration: float) -> tuple[float, float]:
    """The clip to re-examine for a step.

    A step the timeline located: its range. A step it did not locate: the gap between the
    located steps before and after it in rubric order (from the end of the latest one before
    to the start of the earliest one after), running to the start or end of the video when
    one side has none. Either way the clip is widened to take in the first pass's evidence
    times when they lie outside it, as long as it stays within MAX_CLIP_S, then padded by
    CLIP_PAD_S. When no other step was located, or the gap is empty, the clip is the whole
    video."""
    end_cap = duration if duration > 0 else float("inf")
    located = {t.step_id: t for t in timeline.steps if t.found and t.start_s is not None}
    t = located.get(step_id)
    if t is not None:
        lo, hi = t.start_s, t.end_s if t.end_s is not None else t.start_s
    else:
        order = [s.step_id for s in sorted(rubric.steps, key=lambda s: s.order)]
        idx = order.index(step_id) if step_id in order else 0
        before = [located[i] for i in order[:idx] if i in located]
        after = [located[i] for i in order[idx + 1:] if i in located]
        lo = max((b.end_s if b.end_s is not None else b.start_s) for b in before) if before else 0.0
        hi = min(a.start_s for a in after) if after else end_cap
        if not (before or after) or hi <= lo:
            return (0.0, round(duration, 1)) if duration > 0 else (0.0, 60.0)
    if result is not None and result.evidence_start_s is not None and result.evidence_end_s is not None:
        wide_lo, wide_hi = min(lo, result.evidence_start_s), max(hi, result.evidence_end_s)
        if wide_hi - wide_lo <= MAX_CLIP_S:
            lo, hi = wide_lo, wide_hi
    lo = max(0.0, lo - CLIP_PAD_S)
    hi = min(end_cap, hi + CLIP_PAD_S)
    if hi == float("inf"):
        hi = lo + 60.0
    return round(lo, 1), round(max(hi, lo + 1.0), 1)


def is_whole_video(start: float, end: float, duration: float) -> bool:
    return duration > 0 and start <= 0 and end >= duration


def clip_sampling(length_s: float) -> float:
    """Frames per second for a second look: dense on short clips, lighter on long ones."""
    if length_s <= 20:
        return 3.0
    if length_s <= 45:
        return 2.0
    return 1.5


def _double_check_one(ctx, step: RubricStep, start: float, end: float) -> StepResult:
    """One second look on the main model at medium resolution. The whole video is watched at a
    low frame rate to bound its cost; a step's own clip gets denser frames."""
    whole = is_whole_video(start, end, ctx.duration)
    fps = WHOLE_VIDEO_FPS if whole else clip_sampling(end - start)
    j = ctx.generate_json(
        f"evaluate_double_check:{step.step_id}",
        [ctx.video_part(resolution="medium", start_s=start, end_s=end, fps=fps),
         {"type": "text", "text": prompts.double_check_prompt(ctx.skill or {}, step, start, end, ctx.duration, whole)}],
        # thinking "medium" on an ambiguous clip has used 20k thought tokens (about $0.40 a step)
        StepJudgement, model="main", thinking="low", max_output_tokens=DOUBLE_CHECK_MAX_TOKENS,
        optional=True, expect_output_tokens=DOUBLE_CHECK_EXPECTED_TOKENS,
    )
    j.step_id = step.step_id
    return to_step_result(j, ctx.duration, double_checked=True)


def double_check_estimate(ctx, start: float, end: float) -> float:
    """Rough cost of one second look on the clip from start to end."""
    whole = is_whole_video(start, end, ctx.duration)
    return _budget.clip_estimate(ctx, start, end, WHOLE_VIDEO_FPS if whole else clip_sampling(end - start),
                                 "medium", 4000, DOUBLE_CHECK_EXPECTED_TOKENS)


def better_supported(before: StepResult, after: StepResult, whole_video: bool) -> StepResult:
    """Which of two looks at a step to keep. The result is marked double_checked either way.

    The second look wins when it agrees, or when the first could not settle the step. A
    second look that could not see the step on a partial clip says nothing about the rest of
    the video, so it never overturns a passed or failed first verdict. Otherwise, when they
    disagree, the more confident one is kept (the second look on a tie)."""
    if after.status == before.status or before.status == "unverified":
        return after
    if (after.status == "unverified" and not whole_video) or after.confidence < before.confidence:
        note = f' A closer second look said "{after.status}" ({round(after.confidence * 100)}% sure) and was not kept.'
        return before.model_copy(update={"double_checked": True, "evidence": (before.evidence + note).strip()})
    return after


def _double_check(ctx, rubric: Rubric, timeline: Timeline, evaluation: Evaluation,
                  skip: Collection[str] = ()) -> bool:
    """Re-grade the picked steps concurrently and keep the better-supported look at each, in
    place. A step whose second look fails keeps its first result. Returns True if any status changed."""
    picked = pick_double_checks(rubric, evaluation, skip)
    if not picked:
        return False
    changed = False
    steps = {s.step_id: s for s in rubric.steps}
    index = {r.step_id: i for i, r in enumerate(evaluation.steps)}
    windows = {i: step_window(i, rubric, timeline, evaluation.steps[index[i]], ctx.duration) for i in picked}
    fit = _budget.how_many_fit(ctx, [double_check_estimate(ctx, *windows[i]) for i in picked], RESERVE_USD)
    if fit < len(picked):
        ctx.log(f"second looks: {len(picked) - fit} of {len(picked)} skipped, the job's allowance is used up")
    picked = picked[:fit]
    if not picked:
        return False
    with ThreadPoolExecutor(max_workers=len(picked), thread_name_prefix="double_check") as pool:
        futures = {i: pool.submit(_double_check_one, ctx, steps[i], *windows[i]) for i in picked}
    for step_id, future in futures.items():
        before = evaluation.steps[index[step_id]]
        try:
            after = future.result()
        except Exception as exc:
            ctx.log(f"double-check of {step_id} failed, keeping first result: {type(exc).__name__}: {exc}")
            continue
        kept = better_supported(before, after, is_whole_video(*windows[step_id], ctx.duration))
        evaluation.steps[index[step_id]] = kept
        changed = changed or kept.status != before.status
        ctx.log(f"double-check {step_id}: {before.status} ({before.confidence}) -> {after.status} "
                f"({after.confidence}), kept {kept.status}")
    return changed


def _rewrite_feedback(ctx, rubric: Rubric, timeline: Timeline, evaluation: Evaluation) -> str:
    """The first-pass summary can describe a step whose result changed afterwards, so write it
    again from the final step results, the order problems and the safety flags. Text only: no
    video is sent."""
    titles = {s.step_id: s.title for s in rubric.steps}
    lines = "\n".join(f"- {titles.get(r.step_id, r.step_id)}: {r.status}. {r.feedback}" for r in evaluation.steps)
    problems = [f"- Order: {v.message}" for v in timeline.order_violations]
    problems += [f"- Safety ({f.severity}): {f.description}" for f in evaluation.safety_flags if f.severity != "low"]
    prompt = (
        f"A caregiver trainee attempted the skill \"{(ctx.skill or {}).get('name', 'this skill')}\". "
        f"Final result for each step:\n{lines}\n"
        f"Other problems seen:\n{chr(10).join(problems) or '- none'}\n\n"
        "Write two or three plain, encouraging sentences addressed to the caregiver as \"you\": what went well, "
        "then the one or two most important things to fix or to record again so they can be seen. If other "
        "problems are listed, mention the most important one. "
        "Use only what is listed above. Do not mention scores, step numbers or AI. Reply with the sentences only."
    )
    try:
        text = ctx.generate_text("evaluate_summary", [{"type": "text", "text": prompt}], thinking="low",
                                 max_output_tokens=1500, optional=True, expect_output_tokens=600)
    except gemini.GeminiError as exc:
        ctx.log(f"could not rewrite the overall feedback: {exc}")
        return evaluation.overall_feedback
    return text.strip() or evaluation.overall_feedback


# --- pose flag confirmation ----------------------------------------------------
def flag_clip(flag: SafetyFlag, duration: float) -> tuple[float, float]:
    """The clip a pose flag is checked on: its span with FLAG_PAD_S either side."""
    end_cap = duration if duration > 0 else float("inf")
    start = max(0.0, flag.start_s - FLAG_PAD_S)
    end = min(end_cap, (flag.end_s if flag.end_s is not None else flag.start_s) + FLAG_PAD_S)
    return start, max(end, start + 1.0)


def _confirm_one(ctx, rubric: Rubric, flag: SafetyFlag) -> SafetyFlag:
    start, end = flag_clip(flag, ctx.duration)
    reply = ctx.generate_json(
        "evaluate_confirm_flag",
        [ctx.video_part(resolution="medium", start_s=start, end_s=end, fps=2),
         {"type": "text", "text": prompts.confirm_flag_prompt(ctx.skill or {}, flag, start, end, ctx.duration,
                                                              rubric.safety_criteria)}],
        FlagCheckReply, model="main", thinking="low", max_output_tokens=2000,
        optional=True, expect_output_tokens=500,
    )
    if not reply.observed:
        return flag
    seen_start, seen_end = _clamp_span(reply.start_s, reply.end_s, ctx.duration)
    # Gemini is asked about the patient, not about the tracked person, and a bare "track N"
    # label means that track's role is unknown, so it may not be the person Gemini saw.
    label = None if (flag.person_label or "").startswith("track ") else flag.person_label
    return flag.model_copy(update={
        "person_label": label,
        "kind": reply.kind if reply.kind != "other" else flag.kind,
        "severity": reply.severity,
        "start_s": seen_start if seen_start is not None else flag.start_s,
        "end_s": seen_end if seen_end is not None else flag.end_s,
        "description": reply.description.strip() or flag.description,
        "source": "pose_confirmed",
        "counts_toward_score": True,
    })
