"""Pipeline job status.

GET /api/jobs/{id}   {id, kind, status, stage, stages:[{name,status,seconds,error}], error,
                      video_id, skill_id, attempt_id}
GET /api/jobs        the agency's most recent jobs (nurses only)
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, db, repo
from .videos import can_see_video

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("")
def list_jobs(limit: int = 20, user: dict = Depends(auth.nurse)):
    return db.fetch_all(
        """SELECT j.id, j.kind, j.video_id, j.skill_id, j.attempt_id, j.status, j.stage, j.stages, j.error,
                  j.created_at, j.updated_at
           FROM jobs j JOIN videos v ON v.id = j.video_id
           WHERE v.org_id=%s ORDER BY j.created_at DESC LIMIT %s""", (user["org_id"], min(limit, 100)))


@router.get("/{job_id}")
def get_job(job_id: str, user: dict = Depends(auth.current_user)):
    try:
        uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(404, "Job not found") from None
    job = repo.get_job(job_id)
    if not job or not can_see_video(repo.get_video(job["video_id"]), user):
        raise HTTPException(404, "Job not found")
    job.pop("runner", None)
    return job
