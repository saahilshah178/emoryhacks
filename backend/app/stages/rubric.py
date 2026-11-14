"""Stage: rubric. Split a reference video into timestamped steps and write evals.

Two Gemini passes, because one pass at 1 frame per second drifts on long videos:
  1. outline: the whole video at 1 fps. Returns the steps in order with rough times,
     evals, criticality and prerequisites, plus skill-level safety criteria.
  2. bounds: consecutive steps are grouped into clips of up to 150 seconds around
     their rough times, and each clip is re-read at 2 fps to pin every step's start
     and end. Clips are refined in parallel; a step whose refinement fails or looks
     wrong keeps its rough times.
build_rubric() then validates and repairs the result in plain code, so the stored
rubric always satisfies the contract in models.py whatever the model returned.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from pydantic import BaseModel, Field

from .. import config, gemini
from ..models import Classification, Rubric, RubricStep, StepEval
from . import _fake
from .rubric_prompts import bounds_prompt, outline_prompt

MAX_CRITERIA = 4
MIN_STEP_S = 1.0
WINDOW_MAX_S = 150.0  # longest clip refined in one pass-2 call
REFINE_FPS = 2


# --- Gemini output schemas ---------------------------------------------------
class DraftStep(BaseModel):
    number: int = Field(description="1-based position in the demonstration")
    title: str = Field(description="short imperative phrase")
    description: str = Field(description="one sentence")
    start_s: float = Field(description="seconds from the start of the video")
    end_s: float = Field(description="seconds from the start of the video")
    critical: bool
    prerequisites: list[int] = Field(description="numbers of earlier steps that must be completed first")
    pass_criteria: list[str]
    fail_criteria: list[str]
    unverified_when: list[str]
    visual_cues: list[str]


class DraftRubric(BaseModel):
    steps: list[DraftStep]
    safety_criteria: list[str]
    order_matters: bool
    notes: str


class StepBounds(BaseModel):
    number: int = Field(description="the step number as listed")
    found: bool
    start_s: float = Field(description="seconds from the start of the full video")
    end_s: float = Field(description="seconds from the start of the full video")


class WindowBounds(BaseModel):
    steps: list[StepBounds]


@dataclass
class Window:
    """A clip refined in one pass-2 call and the draft steps (indices into the sorted list) inside it."""

    start_s: float
    end_s: float
    members: list[int]


# --- stage entry point -------------------------------------------------------
def run(ctx, classification: Classification) -> Rubric:
    if config.FAKE_AI:
        return _fake.rubric(ctx, classification)
    duration = ctx.duration
    draft = ctx.generate_json(
        "rubric_outline",
        [ctx.video_part(resolution="medium"), gemini.text_part(outline_prompt(classification, duration))],
        DraftRubric, model="main", thinking="medium",
    )
    ctx.log(f"rubric outline: {len(draft.steps)} steps")
    steps = sorted(draft.steps, key=lambda s: (s.start_s, s.number))
    bounds: dict[int, tuple[float, float]] = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for found in pool.map(lambda w: _refine(ctx, steps, w, duration), plan_windows(steps, duration)):
            bounds.update(found)
    return build_rubric(draft, duration, bounds)


def step_padding(duration: float) -> float:
    """Seconds searched either side of a rough step span. Grows with the video's
    length, because outline drift grows on long videos."""
    return 5.0 + 0.03 * duration


def plan_windows(steps: list[DraftStep], duration: float, max_len: float = WINDOW_MAX_S) -> list[Window]:
    """Group consecutive steps (sorted by rough start) into clips of at most max_len
    seconds, each covering its steps' padded spans. One call per window instead of one
    per step avoids paying for the overlapping padding twice."""
    windows: list[Window] = []
    pad = step_padding(duration)
    for i, s in enumerate(steps):
        lo = max(0.0, s.start_s - pad)
        hi = s.end_s + pad if duration <= 0 else min(duration, s.end_s + pad)
        hi = max(hi, lo + 2.0)
        last = windows[-1] if windows else None
        if last and max(hi, last.end_s) - last.start_s <= max_len:
            last.end_s = max(hi, last.end_s)
            last.members.append(i)
        else:
            windows.append(Window(lo, hi, [i]))
    return windows


def _refine(ctx, steps: list[DraftStep], window: Window, duration: float) -> dict[int, tuple[float, float]]:
    """Pin the boundaries of the window's steps on a 2 fps clip. Returns {draft number:
    (start, end)} for the answers that pass sanity checks; the rest keep rough times."""
    members = [steps[i] for i in window.members]
    first, last = window.members[0], window.members[-1]
    prompt = bounds_prompt(
        members, (window.start_s, window.end_s), duration,
        steps[first - 1].title if first > 0 else None, steps[last + 1].title if last + 1 < len(steps) else None,
    )
    try:
        answer = ctx.generate_json(
            "rubric_bounds",
            [ctx.video_part(resolution="medium", start_s=window.start_s, end_s=window.end_s, fps=REFINE_FPS),
             gemini.text_part(prompt)],
            WindowBounds, model="main", thinking="low",
        )
    except gemini.GeminiError as exc:
        ctx.log(f"rubric bounds for {window.start_s:.0f}-{window.end_s:.0f}s failed, keeping rough times: {exc}")
        return {}
    wanted = {s.number: s for s in members}
    out = {}
    for b in answer.steps:
        step = wanted.get(b.number)
        # Answers that are missing or leave the clip are model errors, not better
        # boundaries. A small tolerance absorbs whole-second rounding.
        if (step is None or not b.found or b.end_s <= b.start_s
                or b.start_s < window.start_s - 2 or b.end_s > window.end_s + 2):
            ctx.log(f"rubric bounds rejected: {b.model_dump()} for clip {window.start_s:.0f}-{window.end_s:.0f}")
            continue
        out[b.number] = (b.start_s, b.end_s)
        ctx.log(f"rubric bounds step {b.number} '{step.title}': "
                f"{step.start_s:.0f}-{step.end_s:.0f} -> {b.start_s:.1f}-{b.end_s:.1f}")
    return out


# --- validation and repair ---------------------------------------------------
def build_rubric(draft: DraftRubric, duration: float,
                 bounds: dict[int, tuple[float, float]] | None = None) -> Rubric:
    """Turn Gemini's draft into a valid Rubric.

    Applies refined bounds (keyed by draft step number), drops empty and duplicate
    steps, clamps times to the video, sorts by start time, assigns s1..sN, keeps only
    prerequisites that exist and come earlier, and fills any empty eval list."""
    bounds = bounds or {}
    kept: list[tuple[DraftStep, float, float]] = []
    seen_titles: set[str] = set()
    for step in draft.steps:
        title = _clean(step.title)
        key = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
        if not key or key in seen_titles:
            continue
        seen_titles.add(key)
        start, end = bounds.get(step.number, (step.start_s, step.end_s))
        start, end = _clamp_span(start, end, duration)
        kept.append((step, start, end))
    if not kept:
        raise ValueError("Gemini returned no usable rubric steps")

    kept.sort(key=lambda item: (item[1], item[0].number))
    _trim_overlaps(kept)
    new_id = {step.number: f"s{i + 1}" for i, (step, _, _) in enumerate(kept)}

    steps = []
    for i, (step, start, end) in enumerate(kept):
        earlier = {new_id[s.number] for s, _, _ in kept[:i]}
        must_follow = []
        for n in step.prerequisites:
            sid = new_id.get(n)
            if sid in earlier and sid not in must_follow:
                must_follow.append(sid)
        must_follow.sort(key=lambda sid: int(sid[1:]))
        title = _clean(step.title)
        description = _clean(step.description) or title
        steps.append(RubricStep(
            step_id=f"s{i + 1}", order=i + 1, title=title, description=description,
            start_s=round(start, 1), end_s=round(end, 1), critical=step.critical,
            order_dependent=bool(must_follow), must_follow=must_follow,
            evals=StepEval(
                pass_criteria=_items(step.pass_criteria, MAX_CRITERIA)
                or [f"The caregiver visibly completes this step: {description}"],
                fail_criteria=_items(step.fail_criteria, MAX_CRITERIA)
                or ["The step is skipped.", "The step is done in a way that puts the patient or caregiver at risk."],
                unverified_when=_items(step.unverified_when, 3)
                or ["The caregiver's hands or the patient are out of frame or blocked during this step."],
                visual_cues=_items(step.visual_cues, 3) or [description],
            ),
        ))
    safety = _items(draft.safety_criteria, 6) or [
        "The patient stays steady and centred over their base of support.",
        "The patient shows no signs of pain or distress.",
    ]
    order_matters = draft.order_matters or any(s.order_dependent for s in steps)
    return Rubric(steps=steps, safety_criteria=safety, order_matters=order_matters, notes=_clean(draft.notes))


def _clamp_span(start: float, end: float, duration: float) -> tuple[float, float]:
    """Clamp to [0, duration] and make end at least MIN_STEP_S after start where possible."""
    upper = duration if duration > 0 else max(start, end, MIN_STEP_S)
    start = min(max(0.0, float(start)), upper)
    end = min(max(0.0, float(end)), upper)
    if end - start < MIN_STEP_S:
        end = min(upper, start + MIN_STEP_S)
        start = max(0.0, min(start, end - MIN_STEP_S))
    return start, end


def _trim_overlaps(kept: list[tuple[DraftStep, float, float]]) -> None:
    """End each step where the next one starts, so a playing time maps to one step.
    A step is never shortened below MIN_STEP_S."""
    for i in range(len(kept) - 1):
        step, start, end = kept[i]
        next_start = kept[i + 1][1]
        if end > next_start and next_start - start >= MIN_STEP_S:
            kept[i] = (step, start, next_start)


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _items(values: list[str], limit: int) -> list[str]:
    """Strip, drop empties and duplicates, keep at most limit items."""
    out: list[str] = []
    for v in values or []:
        v = _clean(v)
        if v and v.lower() not in {o.lower() for o in out}:
            out.append(v)
    return out[:limit]
