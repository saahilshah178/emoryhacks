"""Pipeline job status.

GET /api/jobs/{id}   {id, kind, status, stage, stages:[{name,status,seconds,error}], error,
                      video_id, skill_id, attempt_id}
GET /api/jobs        most recent jobs
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from .. import db, repo

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("")
def list_jobs(limit: int = 20):
    return db.fetch_all("SELECT * FROM jobs ORDER BY created_at DESC LIMIT %s", (min(limit, 100),))


@router.get("/{job_id}")
def get_job(job_id: str):
    try:
        uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(404, "Job not found") from None
    job = repo.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job
