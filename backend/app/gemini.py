"""Thin wrapper over the Gemini Interactions API.

All Gemini traffic goes through here so that every call gets the same handling:
  * uploaded videos are cached on the videos row and uploaded again when the handle has
    expired, was made with another API key, or Gemini no longer knows it
  * requests return a validated pydantic object (structured JSON output)
  * rate-limit and server errors are retried with backoff; a missing model falls back to
    the next one in the chain. Retries that Gemini bills for (a reply cut off at the output
    cap, an empty reply) are allowed once each, and a reply that does not match the schema
    is first repaired from its own text, without the video
  * every request and raw response is written to gemini_calls, with a fingerprint of the
    API key and a hash of the request. A job that is run again after a server restart gets
    the logged reply back for any request it already paid for (see _replay)
  * the spend recorded for the current API key is checked against GEMINI_BUDGET_USD before
    each call, and a job's own spend against the hard ceiling its caller passes
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import math
import re
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
# Output tokens assumed for a reply when estimating a call's cost, unless the caller says.
DEFAULT_EXPECTED_OUTPUT = 1500


class GeminiError(RuntimeError):
    pass


class BudgetExceeded(GeminiError):
    """The spend recorded for this API key has reached GEMINI_BUDGET_USD."""


class JobBudgetExceeded(GeminiError):
    """This job has reached its hard spending ceiling."""


class SkippedForBudget(GeminiError):
    """An optional call was not sent because the job has used its allowance."""


class FileUnavailable(GeminiError):
    """Gemini no longer has the uploaded video a request points at."""


def client():
    global _client
    with _client_lock:
        if _client is None:
            if not config.GEMINI_API_KEY:
                raise GeminiError("GEMINI_API_KEY is not set in .env")
            from google import genai

            _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


def key_id(key: str | None = None) -> str:
    """A short fingerprint of an API key (the first 8 hex digits of its SHA-256), stored on
    every logged call so spend is counted per key. Never the key itself."""
    key = config.GEMINI_API_KEY if key is None else key
    return hashlib.sha256(key.encode()).hexdigest()[:8] if key else "nokey"


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


def image_part(jpeg: bytes, mime: str = "image/jpeg", resolution: str | None = None) -> dict:
    """An image input. resolution "low" (about 300 tokens), "medium" or "high" (the default,
    about 1,100 tokens)."""
    part = {"type": "image", "data": base64.b64encode(jpeg).decode(), "mime_type": mime}
    if resolution:
        part["resolution"] = resolution
    return part


# --- cost estimates -------------------------------------------------------
def _seconds(text: str | None) -> float | None:
    return float(text.rstrip("s")) if text else None


def estimate_input_tokens(parts: list[dict], video_seconds: float = 0.0) -> int:
    """Input tokens a request will be billed for, roughly: frames times tokens per frame at the
    part's resolution, the audio track, images, and about four characters per text token.
    video_seconds is the length of a video part that has no end offset."""
    total = 0
    for p in parts:
        kind = p.get("type")
        if kind == "video":
            proc = p.get("processing") or {}
            start = _seconds(proc.get("start_offset")) or 0.0
            end = _seconds(proc.get("end_offset"))
            length = max(1.0, (end if end is not None else video_seconds) - start)
            fps = float(proc.get("fps") or 1.0)
            per_frame = config.VIDEO_TOKENS_PER_FRAME.get(p.get("resolution", "low"), 70)
            total += int(length * (fps * per_frame + config.AUDIO_TOKENS_PER_SECOND))
        elif kind == "image":
            total += config.IMAGE_TOKENS.get(p.get("resolution", "high"), 1100)
        else:
            total += len(p.get("text", "")) // 4
    return total


def price(model: str) -> tuple[float, float]:
    model_id = MODEL_ALIASES[model]() if model in MODEL_ALIASES else model
    return config.GEMINI_PRICES.get(model_id, config.GEMINI_DEFAULT_PRICE)


def estimate_usd(parts: list[dict], model: str = "main", output_tokens: int = DEFAULT_EXPECTED_OUTPUT,
                 video_seconds: float = 0.0) -> float:
    price_in, price_out = price(model)
    return (estimate_input_tokens(parts, video_seconds) * price_in + output_tokens * price_out) / 1_000_000


# --- file upload cache ----------------------------------------------------
_upload_locks: dict[str, threading.Lock] = {}
_upload_guard = threading.Lock()
FILE_MIN_REMAINING = dt.timedelta(hours=2)


def _cached_handle_usable(video: dict, now: dt.datetime) -> bool:
    expires = video.get("gemini_file_expires")
    return bool(video.get("gemini_file_uri") and expires and expires - now > FILE_MIN_REMAINING
                and video.get("gemini_file_key") in (None, key_id()))


def _handle_alive(name: str | None) -> bool:
    """True when Gemini still has the uploaded file and it is ready. Costs nothing."""
    if not name:
        return False
    try:
        f = client().files.get(name=name)
    except Exception:
        return False
    return bool(f.state and f.state.name == "ACTIVE")


def ensure_file(video: dict, *, verify: bool = False, force: bool = False) -> tuple[str, str]:
    """Return (uri, mime) of the video on the Gemini Files API, uploading if needed.

    The cached handle on the videos row is used while it has more than two hours to live and
    was made with the current API key (a file uploaded with another key is not visible to this
    one). verify also asks Gemini whether it still has the file, which is worth one cheap
    request when a job resumes on a handle that may be days old. force always uploads again."""
    with _upload_guard:
        lock = _upload_locks.setdefault(str(video["id"]), threading.Lock())
    with lock:
        now = dt.datetime.now(dt.timezone.utc)
        if not force:
            fresh = db.fetch_one("SELECT gemini_file_name, gemini_file_uri, gemini_file_expires, gemini_file_key "
                                 "FROM videos WHERE id=%s", (video["id"],))
            if fresh:  # another thread may have uploaded it since this row was read
                video.update(fresh)
            if _cached_handle_usable(video, now) and (not verify or _handle_alive(video.get("gemini_file_name"))):
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
            "UPDATE videos SET gemini_file_name=%s, gemini_file_uri=%s, gemini_file_expires=%s, gemini_file_key=%s "
            "WHERE id=%s",
            (f.name, f.uri, expires, key_id(), video["id"]),
        )
        video.update(gemini_file_name=f.name, gemini_file_uri=f.uri, gemini_file_expires=expires,
                     gemini_file_key=key_id())
        return f.uri, f.mime_type or "video/mp4"


def with_uri(parts: list[dict], old_uri: str | None, new_uri: str) -> list[dict]:
    """parts with every video part that pointed at old_uri pointing at new_uri instead."""
    return [{**p, "uri": new_uri} if p.get("type") == "video" and p.get("uri") == old_uri else p for p in parts]


# --- spend ----------------------------------------------------------------
def spent_usd() -> float:
    """Recorded spend of the API key now configured. Calls logged before keys were
    fingerprinted belong to an earlier key and are not counted."""
    row = db.fetch_one("SELECT coalesce(sum(cost_usd), 0)::float AS s FROM gemini_calls WHERE key_id=%s",
                       (key_id(),))
    return float(row["s"]) if row else 0.0


def spent_all_usd() -> float:
    """Recorded spend of every key this database has seen."""
    row = db.fetch_one("SELECT coalesce(sum(cost_usd), 0)::float AS s FROM gemini_calls")
    return float(row["s"]) if row else 0.0


def job_spent_usd(job_id) -> float:
    if job_id is None:
        return 0.0
    row = db.fetch_one("SELECT coalesce(sum(cost_usd), 0)::float AS s FROM gemini_calls WHERE job_id=%s", (job_id,))
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


_FILE_GONE = re.compile(r"\bfiles?\b.{0,120}(not exist|not found|permission|expired|not in an? ACTIVE|deleted)",
                        re.IGNORECASE | re.DOTALL)


def _is_file_gone(exc: Exception, parts: list[dict]) -> bool:
    """A 400/403/404 that is about the uploaded video rather than the model or the key."""
    if _status_code(exc) not in (400, 403, 404) or not any(p.get("type") == "video" for p in parts):
        return False
    text = str(exc)
    if "API_KEY_INVALID" in text or "API key not valid" in text:
        return False
    return bool(_FILE_GONE.search(text))


def _loggable(parts: list[dict]) -> list[dict]:
    out = []
    for p in parts:
        if p.get("type") == "image":
            out.append({"type": "image", "bytes": len(p.get("data", "")) * 3 // 4})
        else:
            out.append(p)
    return out


def request_hash(parts: list[dict], model: str, thinking: str, schema: type[BaseModel] | None) -> str:
    """Identifies a request independently of where the video is stored: the video's uri changes
    when it is uploaded again, the frames sent do not."""
    stable = [{k: v for k, v in p.items() if k != "uri"} for p in parts]
    blob = json.dumps({"parts": stable, "model": model, "thinking": thinking,
                       "schema": schema.__name__ if schema else None}, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:24]


def _log(purpose, model, request, response_text, usage, latency_ms, error, job_id, video_id) -> None:
    input_tokens = int(getattr(usage, "total_input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "total_output_tokens", 0) or 0)
    thought_tokens = int(getattr(usage, "total_thought_tokens", 0) or 0)
    try:
        db.execute(
            """INSERT INTO gemini_calls (id, job_id, video_id, purpose, model, request, response_text,
                                         input_tokens, output_tokens, thought_tokens, cost_usd, latency_ms, error,
                                         key_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (uuid.uuid4(), job_id, video_id, purpose, model, db.J(request), response_text,
             input_tokens, output_tokens, thought_tokens,
             _cost(model, input_tokens, output_tokens, thought_tokens), latency_ms, error, key_id()),
        )
    except Exception:  # logging must never break a pipeline
        pass


def _replay(job_id, purpose: str, digest: str) -> str | None:
    """The reply to an identical request this job already paid for, if one was logged.

    A job that resumes after a server restart runs its stages again; any call that had
    finished before the restart is answered from the log instead of being paid for twice."""
    if job_id is None:
        return None
    try:
        row = db.fetch_one(
            """SELECT response_text FROM gemini_calls
               WHERE job_id=%s AND purpose=%s AND request->>'hash' = %s AND error IS NULL
                 AND coalesce(response_text, '') <> ''
               ORDER BY created_at DESC LIMIT 1""",
            (job_id, purpose, digest))
    except Exception:
        return None
    return row["response_text"] if row else None


def _check_spend(job_id, job_cap_usd: float | None) -> None:
    if spent_usd() >= config.GEMINI_BUDGET_USD:
        raise BudgetExceeded(
            f"Recorded Gemini spend for this API key has reached the ${config.GEMINI_BUDGET_USD:.2f} budget "
            "(GEMINI_BUDGET_USD). Raise it in .env to continue."
        )
    if job_cap_usd is not None and job_id is not None:
        spent = job_spent_usd(job_id)
        if spent >= job_cap_usd:
            raise JobBudgetExceeded(
                f"This job has spent ${spent:.3f} on Gemini, its ceiling is ${job_cap_usd:.2f}; no more calls are sent.")


def _call(purpose: str, parts: list[dict], *, model: str, thinking: str, schema: type[BaseModel] | None,
          job_id, video_id, timeout: float, max_attempts: int, max_output_tokens: int | None = None,
          job_cap_usd: float | None = None) -> str:
    cap = max_output_tokens or config.GEMINI_MAX_OUTPUT_TOKENS
    digest = request_hash(parts, model, thinking, schema)
    replayed = _replay(job_id, purpose, digest)
    if replayed is not None:
        return replayed
    chain = [MODEL_ALIASES[model]() if model in MODEL_ALIASES else model]
    for alias in ("main", "fallback"):
        candidate = MODEL_ALIASES[alias]()
        if candidate not in chain:
            chain.append(candidate)

    last_error: Exception | None = None
    billed_retries = 0  # cut-off and empty replies cost money: one retry for either, per call
    for model_id in chain:
        level = thinking
        request_log = {"input": _loggable(parts), "thinking": thinking, "max_output_tokens": cap,
                       "schema": schema.__name__ if schema else None, "hash": digest}
        for attempt in range(max_attempts):
            _check_spend(job_id, job_cap_usd)
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
                if _is_file_gone(exc, parts):
                    raise FileUnavailable(f"Gemini no longer has the uploaded video: {str(exc)[:300]}") from exc
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
            if cut_off or not text.strip():
                last_error = GeminiError(
                    f"Gemini reply for {purpose} was cut off at the {cap}-token output cap" if cut_off
                    else f"Gemini returned an empty response for {purpose}")
                billed_retries += 1
                if billed_retries > 1:
                    raise last_error
                if cut_off:
                    level = "low"  # leave more of the cap for the reply itself
                else:
                    time.sleep(2 + attempt * 3)
                continue
            return text
    raise GeminiError(f"Gemini request for {purpose} failed after retries: {last_error}")


def _repair_prompt(schema: type[BaseModel], text: str, errors: str) -> str:
    return (
        f"A reply that should be a JSON object matching the {schema.__name__} schema failed validation.\n"
        f"Validation errors: {errors}\n\nThe reply:\n{text[:20000]}\n\n"
        "Return the same content as a JSON object that matches the schema exactly: keep every value that is "
        "valid, fix or shorten the invalid ones (a number with too many digits becomes a plain number), and "
        "fill a missing field with the most sensible value the rest of the reply supports."
    )


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
    job_cap_usd: float | None = None,
) -> T:
    """Send parts to Gemini and return the reply parsed into schema.

    model is "main", "strong" or an explicit model id. thinking is "low", "medium" or "high".
    max_output_tokens caps thinking plus reply (default config.GEMINI_MAX_OUTPUT_TOKENS).
    job_cap_usd stops the call (JobBudgetExceeded) once job_id has spent that much.
    A reply that does not validate is repaired from its own text (no video sent again); only if
    that fails is the whole request asked again.
    Put the video part first and the instructions after it."""
    common = dict(model=model, thinking=thinking, schema=schema, job_id=job_id, video_id=video_id,
                  timeout=timeout, max_output_tokens=max_output_tokens, job_cap_usd=job_cap_usd)
    text = _call(purpose, parts, max_attempts=max_attempts, **common)
    try:
        return schema.model_validate_json(text)
    except ValidationError as first:
        errors = str(first)[:800]
    try:
        fixed = _call(purpose + ":fix", [text_part(_repair_prompt(schema, text, errors))],
                      max_attempts=2, **{**common, "thinking": "low"})
        return schema.model_validate_json(fixed)
    except (ValidationError, GeminiError) as exc:
        if isinstance(exc, (BudgetExceeded, JobBudgetExceeded)):
            raise
    retry_parts = parts + [text_part(
        "Your previous reply did not match the required JSON schema. "
        f"Validation errors: {errors}\n"
        "Answer the whole task again from the start and reply with the complete JSON object, "
        "with every field and every list item, matching the schema exactly."
    )]
    text = _call(purpose + ":repair", retry_parts, max_attempts=2, **common)
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
    job_cap_usd: float | None = None,
) -> str:
    return _call(purpose, parts, model=model, thinking=thinking, schema=None, job_id=job_id, video_id=video_id,
                 timeout=timeout, max_attempts=4, max_output_tokens=max_output_tokens, job_cap_usd=job_cap_usd)
