"""Thin wrapper over the Gemini Interactions API.

All Gemini traffic goes through here so that every call gets the same handling:
  * uploaded videos are cached on the videos row and re-uploaded when they expire
  * requests return a validated pydantic object (structured JSON output)
  * rate-limit and server errors are retried with backoff; a missing model falls
    back to the next one in the chain
  * every request and raw response is written to gemini_calls
  * recorded spend is checked against GEMINI_BUDGET_USD before each call
"""
from __future__ import annotations

import base64
import datetime as dt
import math
import threading
import time
import uuid
import warnings
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from . import config, db

warnings.filterwarnings("ignore", category=SyntaxWarning)

T = TypeVar("T", bound=BaseModel)

_client = None
_client_lock = threading.Lock()
_sem = threading.BoundedSemaphore(config.GEMINI_CONCURRENCY)

RETRYABLE = {408, 429, 500, 502, 503, 504}
MODEL_ALIASES = {
    "main": lambda: config.GEMINI_MODEL_MAIN,
    "strong": lambda: config.GEMINI_MODEL_STRONG,
    "fallback": lambda: config.GEMINI_MODEL_FALLBACK,
}


class GeminiError(RuntimeError):
    pass


class BudgetExceeded(GeminiError):
    pass


def client():
    global _client
    with _client_lock:
        if _client is None:
            if not config.GEMINI_API_KEY:
                raise GeminiError("GEMINI_API_KEY is not set in .env")
            from google import genai

            _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


# --- request parts --------------------------------------------------------
def text_part(text: str) -> dict:
    return {"type": "text", "text": text}


def video_part(
    uri: str,
    mime: str = "video/mp4",
    *,
    resolution: str = "low",
    start_s: float | None = None,
    end_s: float | None = None,
    fps: float | None = None,
) -> dict:
    """A video input. start_s/end_s restrict the request to a clip (whole seconds);
    fps overrides the default sampling rate of 1 frame per second.
    resolution is "low", "medium" or "high" (high costs about four times as much)."""
    part: dict[str, Any] = {"type": "video", "uri": uri, "mime_type": mime, "resolution": resolution}
    processing: dict[str, Any] = {}
    if start_s is not None:
        processing["start_offset"] = f"{max(0, math.floor(start_s))}s"
    if end_s is not None:
        processing["end_offset"] = f"{max(1, math.ceil(end_s))}s"
    if fps is not None:
        processing["fps"] = fps
    if processing:
        processing["type"] = "static"
        part["processing"] = processing
    return part


def image_part(jpeg: bytes, mime: str = "image/jpeg") -> dict:
    return {"type": "image", "data": base64.b64encode(jpeg).decode(), "mime_type": mime}


# --- file upload cache ----------------------------------------------------
def ensure_file(video: dict) -> tuple[str, str]:
    """Return (uri, mime) of the video on the Gemini Files API, uploading if needed."""
    now = dt.datetime.now(dt.timezone.utc)
    expires = video.get("gemini_file_expires")
    if video.get("gemini_file_uri") and expires and expires - now > dt.timedelta(hours=2):
        return video["gemini_file_uri"], video.get("mime") or "video/mp4"

    c = client()
    f = c.files.upload(file=video["path"], config={"mime_type": video.get("mime") or "video/mp4"})
    deadline = time.time() + 600
    while not f.state or f.state.name not in ("ACTIVE", "FAILED"):
        if time.time() > deadline:
            raise GeminiError(f"Gemini did not finish processing {video['path']} within 10 minutes")
        time.sleep(2)
        f = c.files.get(name=f.name)
    if f.state.name == "FAILED":
        raise GeminiError(f"Gemini failed to process the uploaded video {video['path']}")
    expires = getattr(f, "expiration_time", None) or now + dt.timedelta(hours=46)
    db.execute(
        "UPDATE videos SET gemini_file_name=%s, gemini_file_uri=%s, gemini_file_expires=%s WHERE id=%s",
        (f.name, f.uri, expires, video["id"]),
    )
    video.update(gemini_file_name=f.name, gemini_file_uri=f.uri, gemini_file_expires=expires)
    return f.uri, f.mime_type or "video/mp4"


# --- spend ----------------------------------------------------------------
def spent_usd() -> float:
    row = db.fetch_one("SELECT coalesce(sum(cost_usd), 0)::float AS s FROM gemini_calls")
    return float(row["s"]) if row else 0.0


def _cost(model: str, input_tokens: int, output_tokens: int, thought_tokens: int) -> float:
    price_in, price_out = config.GEMINI_PRICES.get(model, config.GEMINI_DEFAULT_PRICE)
    return (input_tokens * price_in + (output_tokens + thought_tokens) * price_out) / 1_000_000


def _status_code(exc: Exception) -> int | None:
    for attr in ("status_code", "code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    return None


def _loggable(parts: list[dict]) -> list[dict]:
    out = []
    for p in parts:
        if p.get("type") == "image":
            out.append({"type": "image", "bytes": len(p.get("data", "")) * 3 // 4})
        else:
            out.append(p)
    return out


def _log(purpose, model, request, response_text, usage, latency_ms, error, job_id, video_id) -> None:
    input_tokens = int(getattr(usage, "total_input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "total_output_tokens", 0) or 0)
    thought_tokens = int(getattr(usage, "total_thought_tokens", 0) or 0)
    try:
        db.execute(
            """INSERT INTO gemini_calls (id, job_id, video_id, purpose, model, request, response_text,
                                         input_tokens, output_tokens, thought_tokens, cost_usd, latency_ms, error)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (uuid.uuid4(), job_id, video_id, purpose, model, db.J(request), response_text,
             input_tokens, output_tokens, thought_tokens,
             _cost(model, input_tokens, output_tokens, thought_tokens), latency_ms, error),
        )
    except Exception:  # logging must never break a pipeline
        pass


def _call(purpose: str, parts: list[dict], *, model: str, thinking: str, schema: type[BaseModel] | None,
          job_id, video_id, timeout: float, max_attempts: int, max_output_tokens: int | None = None) -> str:
    if spent_usd() >= config.GEMINI_BUDGET_USD:
        raise BudgetExceeded(
            f"Recorded Gemini spend has reached the ${config.GEMINI_BUDGET_USD:.2f} budget "
            "(GEMINI_BUDGET_USD). Raise it in .env to continue."
        )
    cap = max_output_tokens or config.GEMINI_MAX_OUTPUT_TOKENS
    chain = [MODEL_ALIASES[model]() if model in MODEL_ALIASES else model]
    for alias in ("main", "fallback"):
        candidate = MODEL_ALIASES[alias]()
        if candidate not in chain:
            chain.append(candidate)

    last_error: Exception | None = None
    for model_id in chain:
        level = thinking
        cut_offs = 0
        request_log = {"input": _loggable(parts), "thinking": thinking, "max_output_tokens": cap,
                       "schema": schema.__name__ if schema else None}
        for attempt in range(max_attempts):
            # The cap covers thinking and the reply together, so a runaway reply cannot run up the bill.
            body: dict[str, Any] = {
                "model": model_id,
                "input": parts,
                "generation_config": {"thinking_level": level, "max_output_tokens": cap},
            }
            if schema is not None:
                body["response_format"] = {
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": schema.model_json_schema(),
                }
            started = time.time()
            try:
                with _sem:
                    result = client().interactions.create(timeout=timeout, **body)
            except Exception as exc:  # network and API errors
                last_error = exc
                code = _status_code(exc)
                _log(purpose, model_id, request_log, None, None, int((time.time() - started) * 1000),
                     f"{type(exc).__name__}: {str(exc)[:500]}", job_id, video_id)
                if code in RETRYABLE or code is None:
                    time.sleep(min(60, 3 * (2 ** attempt)))
                    continue
                if code in (403, 404):
                    break  # this model is not available to the key: try the next one
                raise GeminiError(f"Gemini request for {purpose} failed ({code}): {str(exc)[:500]}") from exc

            text = getattr(result, "output_text", None) or ""
            cut_off = getattr(result, "status", None) == "incomplete"
            _log(purpose, model_id, request_log, text, getattr(result, "usage", None),
                 int((time.time() - started) * 1000), "cut off at the output cap" if cut_off else None,
                 job_id, video_id)
            if cut_off:
                last_error = GeminiError(f"Gemini reply for {purpose} was cut off at the {cap}-token output cap")
                cut_offs += 1
                if cut_offs >= 2:
                    raise last_error
                level = "low"  # leave more of the cap for the reply itself
                continue
            if not text.strip():
                last_error = GeminiError(f"Gemini returned an empty response for {purpose}")
                time.sleep(2 + attempt * 3)
                continue
            return text
    raise GeminiError(f"Gemini request for {purpose} failed after retries: {last_error}")


def generate_json(
    purpose: str,
    parts: list[dict],
    schema: type[T],
    *,
    model: str = "main",
    thinking: str = "low",
    job_id: Any = None,
    video_id: Any = None,
    timeout: float = 600,
    max_attempts: int = 4,
    max_output_tokens: int | None = None,
) -> T:
    """Send parts to Gemini and return the reply parsed into schema.

    model is "main", "strong" or an explicit model id. thinking is "low", "medium" or "high".
    max_output_tokens caps thinking plus reply (default config.GEMINI_MAX_OUTPUT_TOKENS).
    Put the video part first and the instructions after it."""
    text = _call(purpose, parts, model=model, thinking=thinking, schema=schema, job_id=job_id, video_id=video_id,
                 timeout=timeout, max_attempts=max_attempts, max_output_tokens=max_output_tokens)
    try:
        return schema.model_validate_json(text)
    except ValidationError as first:
        retry_parts = parts + [text_part(
            "Your previous reply did not match the required JSON schema. "
            f"Validation errors: {str(first)[:800]}\n"
            "Answer the whole task again from the start and reply with the complete JSON object, "
            "with every field and every list item, matching the schema exactly."
        )]
        text = _call(purpose + ":repair", retry_parts, model=model, thinking=thinking, schema=schema, job_id=job_id,
                     video_id=video_id, timeout=timeout, max_attempts=2, max_output_tokens=max_output_tokens)
        try:
            return schema.model_validate_json(text)
        except ValidationError as second:
            raise GeminiError(f"Gemini reply for {purpose} did not match {schema.__name__}: {second}") from second


def generate_text(
    purpose: str,
    parts: list[dict],
    *,
    model: str = "main",
    thinking: str = "low",
    job_id: Any = None,
    video_id: Any = None,
    timeout: float = 600,
    max_output_tokens: int | None = None,
) -> str:
    return _call(purpose, parts, model=model, thinking=thinking, schema=None, job_id=job_id, video_id=video_id,
                 timeout=timeout, max_attempts=4, max_output_tokens=max_output_tokens)
