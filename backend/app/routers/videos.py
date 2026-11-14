"""Upload, playback and thumbnails. Owned by branch feat/recording.

POST /api/videos            multipart: file, kind=reference|attempt, skill_id (attempt),
                            caregiver_name, expected_slug, expected_name
                            -> {video_id, job_id, attempt_id}
GET  /api/videos/{id}       video row
GET  /api/videos/{id}/file  the MP4, with HTTP Range support for seeking
GET  /api/videos/{id}/thumb?t=12.5   JPEG frame at t seconds (cached on disk)
"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import config, jobs, media, repo

router = APIRouter(prefix="/videos", tags=["videos"])


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
    if kind == "attempt":
        if not skill_id or not repo.get_skill(skill_id):
            raise HTTPException(400, "An attempt needs the skill_id of an existing skill")

    config.ensure_dirs()
    suffix = Path(file.filename or "upload").suffix or ".bin"
    tmp = config.TMP_DIR / f"{uuid.uuid4()}{suffix}"
    size = 0
    with tmp.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > config.MAX_UPLOAD_MB * (1 << 20):
                out.close()
                tmp.unlink(missing_ok=True)
                raise HTTPException(413, f"Video is larger than {config.MAX_UPLOAD_MB} MB")
            out.write(chunk)
    if size == 0:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, "The uploaded file is empty")

    try:
        video = jobs.ingest(str(tmp), kind, file.filename or "")
    except media.MediaError as exc:
        raise HTTPException(422, f"Could not read that video: {exc}") from exc
    finally:
        tmp.unlink(missing_ok=True)

    if kind == "reference":
        job_id = jobs.submit_reference(video["id"], slug=expected_slug or None, name=expected_name or None)
        return {"video_id": video["id"], "job_id": job_id, "attempt_id": None}
    attempt_id = repo.create_attempt(skill_id, video["id"], caregiver_name)
    job_id = jobs.submit_attempt(attempt_id, video["id"], skill_id)
    return {"video_id": video["id"], "job_id": job_id, "attempt_id": attempt_id}


def _video_or_404(video_id: str) -> dict:
    try:
        video = repo.get_video(uuid.UUID(video_id))
    except ValueError:
        video = None
    if not video:
        raise HTTPException(404, "Video not found")
    return video


@router.get("/{video_id}")
def get_video(video_id: str):
    return _video_or_404(video_id)


@router.get("/{video_id}/file")
def get_video_file(video_id: str):
    video = _video_or_404(video_id)
    if not Path(video["path"]).exists():
        raise HTTPException(404, "Video file is missing on disk")
    return FileResponse(video["path"], media_type="video/mp4")


@router.get("/{video_id}/thumb")
def get_thumbnail(video_id: str, t: float = 0.0):
    video = _video_or_404(video_id)
    t = max(0.0, min(float(t), max(0.0, float(video["duration_s"]) - 0.1)))
    out = config.THUMB_DIR / f"{video['id']}_{int(t * 10):06d}.jpg"
    if not out.exists():
        try:
            media.thumbnail(video["path"], t, out)
        except media.MediaError as exc:
            raise HTTPException(404, str(exc)) from exc
    return FileResponse(out, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
