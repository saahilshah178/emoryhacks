"""Planning optional Gemini calls against a job's allowance (see jobs.StageContext)."""
from __future__ import annotations

from collections.abc import Sequence

from .. import gemini


def clip_estimate(ctx, start_s: float, end_s: float, fps: float, resolution: str = "medium",
                  prompt_chars: int = 3000, output_tokens: int = 1200, model: str = "main") -> float:
    """Rough cost of one call on a clip of ctx's video, without uploading anything."""
    part = gemini.video_part("estimate", resolution=resolution, start_s=start_s, end_s=end_s, fps=fps)
    return gemini.estimate_usd([part, gemini.text_part("x" * prompt_chars)], model, output_tokens, ctx.duration)


def how_many_fit(ctx, estimates: Sequence[float], reserve_usd: float = 0.0) -> int:
    """How many of the calls, taken in order, fit together in what is left of the job's
    allowance while keeping reserve_usd for later stages. A context without an allowance
    (a script running one stage) affords them all."""
    affordable = getattr(ctx, "affordable", None)
    if affordable is None:
        return len(estimates)
    total = 0.0
    for n, estimate in enumerate(estimates):
        total += estimate
        if not affordable(total + reserve_usd):
            return n
    return len(estimates)
