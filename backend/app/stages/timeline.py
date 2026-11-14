"""Stage: timeline. Locate each rubric step in an attempt and check the order.

The whole attempt is watched once, by assess.assess(), which locates and grades every step
in one Gemini call (evaluate.run reads the same reply). This stage takes the locations from
it. Up to 2 minutes the video is sampled at 2 frames per second, where boundaries were within
about half a second of hand-labelled truth. Longer videos are sampled more sparsely, and for
those a refine pass, which re-locates a found step on a short clip at REFINE_FPS, is offered
as optional spending: it runs only while the job is within its allowance. Everything after
that (clamping, performed order, missing steps, order violations) is computed here in code
so it is deterministic and never left to the model. A step the reply found not needed
(assess.not_needed) is not found, but it is not missing either.
"""
from __future__ import annotations

import re
from collections.abc import Collection
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel, Field

from .. import config, gemini
from ..models import OrderViolation, Rubric, RubricStep, Timeline, TimelineStep
from . import _budget, _fake, assess, timeline_prompts
from .evaluate_prompts import sight_only

MIN_SPAN_S = 1.0           # a found step lasts at least this long
ORDER_TOLERANCE_S = 1.0    # starts closer than this are not an order violation
REFINE_PAD_S = 3.0         # context either side of a step for the refine clip
REFINE_FPS = 3.0
REFINE_BELOW_FPS = 1.0     # the refine pass is offered when the whole video was sampled sparser than this
MAX_REFINES = 4            # refine calls per attempt, longest-uncertain first
REFINE_MAX_TOKENS = 2000


class _Located(BaseModel):
    # start_s and end_s have no default so the schema marks them required; without that the
    # model tends to leave out end_s.
    step_id: str
    performed: bool
    start_s: float | None = Field(description="seconds; null only when not performed")
    end_s: float | None = Field(description="seconds; null only when not performed")
    confidence: float = Field(description="0 to 1")
    note: str = ""


class _RefineReply(BaseModel):
    performed: bool
    start_s: float
    end_s: float
    confidence: float = Field(description="0 to 1")


def run(ctx, rubric: Rubric, refine: bool | None = None) -> Timeline:
    """Find every rubric step in the attempt video.

    refine forces the per-step boundary pass on or off; None offers it (as optional spending)
    only for sparsely sampled videos."""
    if config.FAKE_AI:
        return _fake.timeline(ctx, rubric)
    duration = ctx.duration
    reply = assess.assess(ctx, rubric)
    ctx.log("observed: " + " | ".join(f"{o.start_s}-{o.end_s} {o.action}" for o in reply.observed))
    steps = clean_steps(rubric, located_from(reply), duration)
    if refine is None:
        refine = sample_fps(duration) < REFINE_BELOW_FPS
    if refine:
        steps = _refine_all(ctx, rubric, steps)
    return build_timeline(rubric, steps, not_needed_from(rubric, reply))


def not_needed_from(rubric: Rubric, reply: assess.AssessReply) -> set[str]:
    """Steps the whole-video reply found not needed, where that verdict stands (assess.not_needed)."""
    by_id = {s.step_id: s for s in rubric.steps}
    first: dict[str, assess.StepAssessment] = {}
    for s in reply.steps:
        first.setdefault(s.step_id.strip(), s)
    return {i for i, s in first.items() if i in by_id and assess.not_needed(by_id[i], s.status, s.performed)}


def located_from(reply: assess.AssessReply) -> list[_Located]:
    """The locating half of the whole-video reply, as the timeline reads it."""
    return [_Located(step_id=s.step_id, performed=s.performed, start_s=s.start_s, end_s=s.end_s,
                     confidence=s.timing_confidence_pct / 100, note=s.note) for s in reply.steps]


def sample_fps(duration: float) -> float:
    """Frames per second the whole-video look uses (see assess.sample_fps)."""
    return assess.sample_fps(duration)


def _refine_all(ctx, rubric: Rubric, steps: list[TimelineStep]) -> list[TimelineStep]:
    """Refine up to MAX_REFINES found steps, least confident first, while the job can afford it."""
    by_id = {s.step_id: s for s in rubric.steps}
    found = sorted((t for t in steps if t.found), key=lambda t: t.confidence)[:MAX_REFINES]
    estimates = [_budget.clip_estimate(ctx, *refine_clip(t, ctx.duration), REFINE_FPS, "low", 1500, 600)
                 for t in found]
    found = found[:_budget.how_many_fit(ctx, estimates)]
    if not found:
        return steps
    with ThreadPoolExecutor(max_workers=config.GEMINI_CONCURRENCY) as pool:
        done = {t.step_id: r for t, r in zip(found, pool.map(lambda t: _refine(ctx, by_id[t.step_id], t), found))}
    return keep_performed_order(steps, [done.get(t.step_id, t) for t in steps])


def clamp_span(start: float, end: float | None, duration: float) -> tuple[float, float]:
    """Keep a span inside the video with end after start (at least MIN_SPAN_S when the video allows)."""
    duration = max(duration, 0.0)
    start = min(max(0.0, float(start)), max(0.0, duration - MIN_SPAN_S))
    end = start + MIN_SPAN_S if end is None else float(end)
    end = min(max(end, start + MIN_SPAN_S), duration) if duration > start else start
    return round(start, 1), round(end, 1)


def clean_steps(rubric: Rubric, located: list[_Located], duration: float) -> list[TimelineStep]:
    """One TimelineStep per rubric step, in rubric order, from whatever the model returned."""
    first: dict[str, _Located] = {}
    for item in located:
        first.setdefault(item.step_id.strip(), item)
    steps = []
    for rs in rubric.steps:
        item = first.get(rs.step_id)
        if item is None:
            steps.append(TimelineStep(step_id=rs.step_id, found=False, note="Not reported by the model."))
            continue
        confidence = round(min(max(item.confidence, 0.0), 1.0), 2)
        note = titles_for_ids(rubric, item.note.strip())[:300]
        if not item.performed or item.start_s is None or (duration > 0 and item.start_s > duration + 1):
            steps.append(TimelineStep(step_id=rs.step_id, found=False, confidence=confidence, note=note))
            continue
        start, end = clamp_span(item.start_s, item.end_s, duration)
        steps.append(TimelineStep(step_id=rs.step_id, found=True, start_s=start, end_s=end,
                                  confidence=confidence, note=note))
    return steps


def titles_for_ids(rubric: Rubric, text: str) -> str:
    """Notes are shown to the nurse, who knows steps by title, not by id: replace every rubric
    step id in text ("Performed before s2") with the step's quoted title."""
    titles = {s.step_id: s.title for s in rubric.steps}
    return re.sub(r"\b[sS]\d+\b", lambda m: f'"{titles[m.group(0).lower()]}"' if m.group(0).lower() in titles
                  else m.group(0), text)


def keep_performed_order(first: list[TimelineStep], refined: list[TimelineStep]) -> list[TimelineStep]:
    """Refined times, except where refining would move a step past a located neighbour.

    The located steps are walked in first-pass start order. A step keeps its refined times only
    when the refined start is no earlier than the previous step's final start and no later than
    the next step's first-pass start; otherwise it keeps its first-pass times. So the performed
    order, and therefore the order check, is the same as the first pass found."""
    refined_by_id = {s.step_id: s for s in refined}
    located = sorted((s for s in first if s.found and s.start_s is not None), key=lambda s: s.start_s)
    final: dict[str, TimelineStep] = {}
    prev_start = float("-inf")
    for k, step in enumerate(located):
        candidate = refined_by_id.get(step.step_id, step)
        next_start = located[k + 1].start_s if k + 1 < len(located) else float("inf")
        ok = candidate.start_s is not None and prev_start <= candidate.start_s <= next_start
        final[step.step_id] = candidate if ok else step
        prev_start = final[step.step_id].start_s
    return [final.get(s.step_id, s) for s in first]


def refine_clip(step: TimelineStep, duration: float) -> tuple[float, float]:
    """The clip a refine call looks at: the located step with REFINE_PAD_S either side."""
    return max(0.0, step.start_s - REFINE_PAD_S), min(duration, step.end_s + REFINE_PAD_S)


def _refine(ctx, rs: RubricStep, step: TimelineStep) -> TimelineStep:
    """Tighten one found step's boundaries on a clip around it. Keeps the first-pass times if the
    refine call fails, is skipped for budget, or answers with something outside the clip."""
    clip_start, clip_end = refine_clip(step, ctx.duration)
    prompt = timeline_prompts.refine(rs.title, rs.description, sight_only(rs.evals.visual_cues), step.start_s,
                                     step.end_s, clip_start, clip_end)
    try:
        reply = ctx.generate_json(
            f"timeline_refine:{rs.step_id}",
            [ctx.video_part(resolution="low", start_s=clip_start, end_s=clip_end, fps=REFINE_FPS),
             gemini.text_part(prompt)],
            _RefineReply, model="main", thinking="low", max_output_tokens=REFINE_MAX_TOKENS,
            optional=True, expect_output_tokens=600,
        )
    except (gemini.BudgetExceeded, gemini.JobBudgetExceeded):
        raise
    except gemini.GeminiError as exc:
        ctx.log(f"refine {rs.step_id} failed: {exc}")
        return step
    inside = clip_start - 1 <= reply.start_s <= clip_end and reply.end_s >= clip_start
    if not reply.performed or not inside:
        return step
    start, end = clamp_span(max(reply.start_s, clip_start), min(reply.end_s, clip_end), ctx.duration)
    return step.model_copy(update={"start_s": start, "end_s": end})


def build_timeline(rubric: Rubric, steps: list[TimelineStep], not_needed: Collection[str] = ()) -> Timeline:
    """Add performed order, missing steps and order violations to located steps.

    A step in not_needed that was not found is not missing: it was not needed in this
    recording. For the order check it is like any step not found, so the steps after it are
    checked against its own prerequisites."""
    order = {s.step_id: i for i, s in enumerate(rubric.steps)}
    found = sorted((s for s in steps if s.found), key=lambda s: (s.start_s, order.get(s.step_id, 0)))
    rank = {s.step_id: i + 1 for i, s in enumerate(found)}
    steps = [s.model_copy(update={"performed_index": rank.get(s.step_id),
                                  "note": s.note or ("Not needed in this recording."
                                                     if s.step_id in not_needed and not s.found else "")})
             for s in steps]
    return Timeline(
        steps=steps,
        order_violations=order_violations(rubric, steps),
        missing_step_ids=[s.step_id for s in steps if not s.found and s.step_id not in not_needed],
    )


def order_violations(rubric: Rubric, steps: list[TimelineStep]) -> list[OrderViolation]:
    """A found order-dependent step S violates order when it starts more than ORDER_TOLERANCE_S before a
    found prerequisite M starts. A prerequisite that is missing altogether is not an order violation,
    but its own prerequisites are checked in its place, so skipping the step in the middle of a
    chain (brakes -> gait belt -> stand) does not hide that the last was done before the first."""
    if not rubric.order_matters:
        return []
    rubric_by_id = {s.step_id: s for s in rubric.steps}
    found = {s.step_id: s for s in steps if s.found and s.start_s is not None}
    violations = []
    for step_id, s in found.items():
        rs = rubric_by_id.get(step_id)
        if rs is None or not rs.order_dependent:
            continue
        for m_id in _found_prerequisites(rs, rubric_by_id, found):
            m = found[m_id]
            if s.start_s < m.start_s - ORDER_TOLERANCE_S:
                violations.append(OrderViolation(
                    step_id=step_id, expected_after=m_id, at_s=s.start_s,
                    message=f'"{rs.title}" was performed before "{rubric_by_id[m_id].title}".',
                ))
    return sorted(violations, key=lambda v: (v.at_s, v.step_id))


def _found_prerequisites(step: RubricStep, rubric_by_id: dict[str, RubricStep],
                         found: dict[str, TimelineStep]) -> list[str]:
    """The step's prerequisites that were found, looking through any that were not found to
    their own prerequisites."""
    out: list[str] = []
    pending, seen = list(step.must_follow), {step.step_id}
    while pending:
        m_id = pending.pop(0)
        if m_id in seen or m_id not in rubric_by_id:
            continue
        seen.add(m_id)
        if m_id in found:
            out.append(m_id)
        else:
            pending.extend(rubric_by_id[m_id].must_follow)
    return out
