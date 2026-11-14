"""Upload, playback and thumbnails. Owned by branch feat/recording.

POST /api/videos            multipart: file, kind=reference|attempt, skill_id (attempt),
                            caregiver_name, expected_slug, expected_name
                            -> {video_id, job_id, attempt_id}
GET  /api/videos/{id}       video row
GET  /api/videos/{id}/file  the MP4, with HTTP Range support for seeking
GET  /api/videos/{id}/thumb?t=12.5   JPEG frame at t seconds (cached on disk)

Upload errors come back as {"detail": "<sentence for the user>"}: 400 for a bad
request or empty file, 413 for a file over the size limit, 422 for a file that
is not a readable video.
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from .. import config, jobs, media, repo

router = APIRouter(prefix="/videos", tags=["videos"])
log = logging.getLogger(__name__)

MAX_NAME_CHARS = 120


@router.post("")
async def upload_video(
    file: UploadFile = File(...),
    kind: str = Form(...),
    skill_id: str | None = Form(None),
    caregiver_name: str = Form(""),
    expected_slug: str | None = Form(None),
    expected_name: str | None = Form(None),
):
    if kind not in ("reference", "attempt"):
        raise HTTPException(400, "kind must be 'reference' or 'attempt'")
    if kind == "attempt" and not _skill_exists(skill_id):
        raise HTTPException(400, "An attempt needs the skill_id of an existing skill")

    tmp = await _save_upload(file)
    try:
        # Converting can take a minute for a long recording; keep the event loop free.
        video = await run_in_threadpool(jobs.ingest, str(tmp), kind, file.filename or "")
    except media.MediaError as exc:
        log.warning("Upload %r could not be converted: %s", file.filename, exc)
        raise HTTPException(422, "Could not read that video. The file may be damaged or not a video; "
                                 "try recording again or choose a different file.") from exc
    finally:
        tmp.unlink(missing_ok=True)

    if kind == "reference":
        job_id = jobs.submit_reference(video["id"], slug=expected_slug or None, name=expected_name or None)
        return {"video_id": video["id"], "job_id": job_id, "attempt_id": None}
    attempt_id = repo.create_attempt(skill_id, video["id"], caregiver_name.strip()[:MAX_NAME_CHARS])
    job_id = jobs.submit_attempt(attempt_id, video["id"], skill_id)
    return {"video_id": video["id"], "job_id": job_id, "attempt_id": attempt_id}


async def _save_upload(file: UploadFile) -> Path:
    """Copy the upload to a temp file, enforcing the size limit and rejecting empty files."""
    config.ensure_dirs()
    suffix = Path(file.filename or "upload").suffix or ".bin"
    tmp = config.TMP_DIR / f"{uuid.uuid4()}{suffix}"
    limit = config.MAX_UPLOAD_MB * (1 << 20)
    size = 0
    with tmp.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > limit:
                break
            out.write(chunk)
    if size > limit:
        tmp.unlink(missing_ok=True)
        raise HTTPException(413, f"That video is larger than the {config.MAX_UPLOAD_MB} MB limit. "
                                 "Record a shorter clip or trim the file first.")
    if size == 0:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, "The uploaded file is empty. Record again or choose a different file.")
    return tmp


def _skill_exists(skill_id: str | None) -> bool:
    try:
        return bool(skill_id) and repo.get_skill(uuid.UUID(skill_id)) is not None
    except ValueError:
        return False


def _video_or_404(video_id: str) -> dict:
    try:
        video = repo.get_video(uuid.UUID(video_id))
    except ValueError:
        video = None
    if not video:
        raise HTTPException(404, "Video not found")
    return video


def _local_or_404(video: dict) -> dict:
    """The video with its file present on this machine (rebuilt from reference_vids/ if it can be)."""
    try:
        return repo.ensure_video_file(video)
    except media.MediaError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/{video_id}")
def get_video(video_id: str):
    return _video_or_404(video_id)


@router.get("/{video_id}/file")
def get_video_file(video_id: str):
    """The stored MP4. FileResponse answers Range requests with 206, which <video> needs to seek."""
    video = _local_or_404(_video_or_404(video_id))
    return FileResponse(video["path"], media_type="video/mp4")


@router.get("/{video_id}/thumb")
def get_thumbnail(video_id: str, t: float = 0.0):
    video = _local_or_404(_video_or_404(video_id))
    t = max(0.0, min(float(t), max(0.0, float(video["duration_s"]) - 0.1)))
    out = config.THUMB_DIR / f"{video['id']}_{int(t * 10):06d}.jpg"
    if not out.exists():
        try:
            media.thumbnail(video["path"], t, out)
        except media.MediaError as exc:
            raise HTTPException(404, str(exc)) from exc
    return FileResponse(out, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
