"""Stage: timeline. Locate each rubric step in an attempt and check the order.

Pass 1 sends the whole attempt and asks, for every rubric step, whether it was
performed and when. At 2 frames per second (attempts up to 2 minutes) its
boundaries were within about half a second of hand-labelled truth, so pass 2,
which re-locates each found step on a short clip at 4 fps, runs by default only
when a longer video had to be sampled more sparsely. Everything after that
(clamping, performed order, missing steps, order violations) is computed here in
code so it is deterministic and never left to the model.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel, Field

from .. import config, gemini
from ..models import OrderViolation, Rubric, RubricStep, Timeline, TimelineStep
from . import _fake, timeline_prompts

MIN_SPAN_S = 1.0           # a found step lasts at least this long
ORDER_TOLERANCE_S = 1.0    # starts closer than this are not an order violation
REFINE_PAD_S = 4.0         # context either side of a step for the refine clip
REFINE_FPS = 4.0
DENSE_FPS = 2.0            # whole-video sampling rate for attempts up to 2 minutes


class _Observed(BaseModel):
    start_s: float
    end_s: float
    action: str


class _Located(BaseModel):
    # start_s and end_s have no default so the schema marks them required; without that the
    # model tends to leave out end_s.
    step_id: str
    performed: bool
    start_s: float | None = Field(description="seconds; null only when not performed")
    end_s: float | None = Field(description="seconds; null only when not performed")
    confidence: float = Field(description="0 to 1")
    note: str = ""


class _LocateReply(BaseModel):
    observed: list[_Observed]
    steps: list[_Located]


class _RefineReply(BaseModel):
    performed: bool
    start_s: float
    end_s: float
    confidence: float = Field(description="0 to 1")


def run(ctx, rubric: Rubric, refine: bool | None = None) -> Timeline:
    """Find every rubric step in the attempt video.

    refine forces the per-step boundary pass on or off; None runs it only for sparsely sampled videos."""
    if config.FAKE_AI:
        return _fake.timeline(ctx, rubric)
    duration = ctx.duration
    reply = ctx.generate_json(
        "timeline",
        [ctx.video_part(resolution="low", fps=sample_fps(duration)),
         gemini.text_part(timeline_prompts.locate(rubric, duration))],
        _LocateReply, model="main", thinking="medium",
    )
    ctx.log("observed: " + " | ".join(f"{o.start_s:.0f}-{o.end_s:.0f} {o.action}" for o in reply.observed))
    steps = clean_steps(rubric, reply.steps, duration)
    if refine is None:
        refine = sample_fps(duration) < DENSE_FPS
    if refine:
        by_id = {s.step_id: s for s in rubric.steps}
        with ThreadPoolExecutor(max_workers=config.GEMINI_CONCURRENCY) as pool:
            steps = list(pool.map(lambda t: _refine(ctx, by_id[t.step_id], t) if t.found else t, steps))
    return build_timeline(rubric, steps)


def sample_fps(duration: float) -> float:
    """Frames per second for the whole-video pass: dense for typical 30-120 s attempts, cheaper beyond."""
    if duration <= 120:
        return DENSE_FPS
    if duration <= 300:
        return 1.0
    return 0.5


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
        note = item.note.strip()[:300]
        if not item.performed or item.start_s is None or (duration > 0 and item.start_s > duration + 1):
            steps.append(TimelineStep(step_id=rs.step_id, found=False, confidence=confidence, note=note))
            continue
        start, end = clamp_span(item.start_s, item.end_s, duration)
        steps.append(TimelineStep(step_id=rs.step_id, found=True, start_s=start, end_s=end,
                                  confidence=confidence, note=note))
    return steps


def _refine(ctx, rs: RubricStep, step: TimelineStep) -> TimelineStep:
    """Tighten one found step's boundaries on a clip around it. Keeps the first-pass times if the
    refine call fails or answers with something outside the clip."""
    clip_start = max(0.0, step.start_s - REFINE_PAD_S)
    clip_end = min(ctx.duration, step.end_s + REFINE_PAD_S)
    prompt = timeline_prompts.refine(rs.title, rs.description, rs.evals.visual_cues, step.start_s, step.end_s,
                                     clip_start, clip_end)
    try:
        reply = ctx.generate_json(
            f"timeline_refine:{rs.step_id}",
            [ctx.video_part(resolution="low", start_s=clip_start, end_s=clip_end, fps=REFINE_FPS),
             gemini.text_part(prompt)],
            _RefineReply, model="main", thinking="low",
        )
    except gemini.BudgetExceeded:
        raise
    except gemini.GeminiError as exc:
        ctx.log(f"refine {rs.step_id} failed: {exc}")
        return step
    inside = clip_start - 1 <= reply.start_s <= clip_end and reply.end_s >= clip_start
    if not reply.performed or not inside:
        return step
    start, end = clamp_span(max(reply.start_s, clip_start), min(reply.end_s, clip_end), ctx.duration)
    return step.model_copy(update={"start_s": start, "end_s": end})


def build_timeline(rubric: Rubric, steps: list[TimelineStep]) -> Timeline:
    """Add performed order, missing steps and order violations to located steps."""
    order = {s.step_id: i for i, s in enumerate(rubric.steps)}
    found = sorted((s for s in steps if s.found), key=lambda s: (s.start_s, order.get(s.step_id, 0)))
    rank = {s.step_id: i + 1 for i, s in enumerate(found)}
    steps = [s.model_copy(update={"performed_index": rank.get(s.step_id)}) for s in steps]
    return Timeline(
        steps=steps,
        order_violations=order_violations(rubric, steps),
        missing_step_ids=[s.step_id for s in steps if not s.found],
    )


def order_violations(rubric: Rubric, steps: list[TimelineStep]) -> list[OrderViolation]:
    """A found order-dependent step S violates order when it starts more than ORDER_TOLERANCE_S before a
    found prerequisite M starts. A prerequisite that is missing altogether is not an order violation."""
    if not rubric.order_matters:
        return []
    rubric_by_id = {s.step_id: s for s in rubric.steps}
    found = {s.step_id: s for s in steps if s.found and s.start_s is not None}
    violations = []
    for step_id, s in found.items():
        rs = rubric_by_id.get(step_id)
        if rs is None or not rs.order_dependent:
            continue
        for m_id in rs.must_follow:
            m = found.get(m_id)
            if m is not None and s.start_s < m.start_s - ORDER_TOLERANCE_S:
                violations.append(OrderViolation(
                    step_id=step_id, expected_after=m_id, at_s=s.start_s,
                    message=f'"{rs.title}" was performed before "{rubric_by_id[m_id].title}".',
                ))
    return sorted(violations, key=lambda v: (v.at_s, v.step_id))
