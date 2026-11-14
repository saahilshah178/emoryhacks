"""Background pipelines.

A reference video runs:  gemini_upload -> classify -> rubric -> pose -> roles
An attempt runs:         gemini_upload -> timeline -> evaluate -> pose -> roles
                         -> confirm_flags -> score

Pose extraction is CPU work that needs no Gemini output, so it starts in its own
thread when the job starts and is joined at the "pose" stage. Pose is advisory: if
it fails, the stage is recorded as failed and the job carries on.

Stage contract (see app/stages/*.py). Each function takes a StageContext:
  classify.run(ctx) -> Classification
  rubric.run(ctx, classification) -> Rubric
  timeline.run(ctx, rubric) -> Timeline
  evaluate.run(ctx, rubric, timeline) -> Evaluation
  evaluate.confirm_pose_flags(ctx, rubric, flags) -> list[SafetyFlag]
  scoring.score(rubric, timeline, evaluation, flags) -> Score
  pose.extract(ctx) -> PoseSummary            (writes frames with repo.replace_pose)
  pose.assign_roles(ctx, people) -> None      (labels tracks with repo.set_track_roles)
  pose.relabel_flags(video_id, flags) -> list[SafetyFlag]   (names the person once roles are known)
"""
from __future__ import annotations

import datetime as dt
import time
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

from . import config, gemini, media, repo
from .models import Classification, PoseSummary

_jobs = ThreadPoolExecutor(max_workers=2, thread_name_prefix="job")
_pose = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pose")

REFERENCE_STAGES = ["gemini_upload", "classify", "rubric", "pose", "roles"]
ATTEMPT_STAGES = ["gemini_upload", "timeline", "evaluate", "pose", "roles", "confirm_flags", "score"]
ADVISORY_STAGES = {"pose", "roles", "confirm_flags"}


@dataclass
class StageContext:
    """What a stage needs: the video, the job, and helpers for Gemini inputs."""

    job_id: Any
    video: dict
    skill: dict | None = None
    attempt: dict | None = None
    slug_hint: str | None = None
    logs: list[str] = field(default_factory=list)

    @property
    def video_id(self):
        return self.video["id"]

    @property
    def path(self) -> str:
        return self.video["path"]

    @property
    def duration(self) -> float:
        return float(self.video.get("duration_s") or 0)

    def video_part(self, **kwargs) -> dict:
        """A Gemini video input for this video. Accepts resolution, start_s, end_s, fps."""
        uri, mime = gemini.ensure_file(self.video)
        return gemini.video_part(uri, mime, **kwargs)

    def frame_jpeg(self, t: float, width: int = 960) -> bytes:
        return media.frame_jpeg(self.path, t, width)

    def generate_json(self, purpose: str, parts: list[dict], schema, **kwargs):
        """gemini.generate_json with this job and video recorded on the call log."""
        return gemini.generate_json(purpose, parts, schema, job_id=self.job_id, video_id=self.video_id, **kwargs)

    def generate_text(self, purpose: str, parts: list[dict], **kwargs) -> str:
        """gemini.generate_text with this job and video recorded on the call log."""
        return gemini.generate_text(purpose, parts, job_id=self.job_id, video_id=self.video_id, **kwargs)

    def log(self, message: str) -> None:
        self.logs.append(message)


class Tracker:
    """Records per-stage status on the jobs row."""

    def __init__(self, job_id, names: list[str]):
        self.job_id = job_id
        self.stages = [{"name": n, "status": "pending", "seconds": None, "error": None} for n in names]
        repo.update_job(job_id, status="running", stage=names[0], stages=self.stages, error=None)

    def run(self, name: str, fn: Callable[[], Any]) -> Any:
        entry = next(s for s in self.stages if s["name"] == name)
        entry["status"] = "running"
        repo.update_job(self.job_id, stage=name, stages=self.stages)
        started = time.time()
        try:
            result = fn()
            entry["status"] = "done"
            return result
        except Exception as exc:
            entry["status"] = "error"
            entry["error"] = f"{type(exc).__name__}: {str(exc)[:500]}"
            if name in ADVISORY_STAGES:
                return None
            raise
        finally:
            entry["seconds"] = round(time.time() - started, 1)
            repo.update_job(self.job_id, stages=self.stages)


def _start_pose(ctx: StageContext) -> Future | None:
    if not config.POSE_ENABLED:
        return None
    from .stages import pose

    return _pose.submit(pose.extract, ctx)


def _join_pose(future: Future | None) -> PoseSummary:
    if future is None:
        return PoseSummary(note="pose disabled")
    return future.result(timeout=3600)


def run_reference(job_id, slug: str | None = None, name: str | None = None) -> None:
    """Run the nurse-side pipeline. slug/name force the stored skill's identity
    (used when seeding known reference videos); the classifier still runs."""
    from .stages import classify, pose, rubric

    try:  # setup is inside the try so that a failure here marks the job instead of leaving it queued
        job = repo.get_job(job_id)
        video = repo.ensure_video_file(repo.get_video(job["video_id"]))
        ctx = StageContext(job_id=job_id, video=video, slug_hint=slug)
        track = Tracker(job_id, REFERENCE_STAGES)
        pose_future = _start_pose(ctx)
        track.run("gemini_upload", lambda: None if config.FAKE_AI else gemini.ensure_file(video))
        classification: Classification = track.run("classify", lambda: classify.run(ctx))
        rb = track.run("rubric", lambda: rubric.run(ctx, classification))
        skill_id = repo.create_skill(classification, rb, video["id"], slug=slug, name=name)
        repo.update_job(job_id, skill_id=skill_id)
        summary: PoseSummary | None = track.run("pose", lambda: _join_pose(pose_future))
        track.run("roles", lambda: pose.assign_roles(ctx, classification.people))
        if summary and summary.candidate_flags:  # advisory only: a reference video is never scored
            repo.save_flags(video["id"], None, pose.relabel_flags(video["id"], summary.candidate_flags),
                            sources=("pose", "pose_confirmed"))
        repo.update_job(job_id, status="done", stage="done", error=None)
    except Exception as exc:
        repo.update_job(job_id, status="error", error=f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-1500:]}")


def run_attempt(job_id) -> None:
    """Run the caregiver-side pipeline for an attempt."""
    from .stages import evaluate, pose, scoring, timeline

    try:  # setup is inside the try so that a failure here marks the job instead of leaving it queued
        job = repo.get_job(job_id)
        video = repo.ensure_video_file(repo.get_video(job["video_id"]))
        attempt = repo.get_attempt(job["attempt_id"])
        skill = repo.get_skill(attempt["skill_id"])
        rb = repo.get_rubric(attempt["skill_id"])
        ctx = StageContext(job_id=job_id, video=video, skill=skill, attempt=attempt)
        track = Tracker(job_id, ATTEMPT_STAGES)
        pose_future = _start_pose(ctx)
        track.run("gemini_upload", lambda: None if config.FAKE_AI else gemini.ensure_file(video))

        tl = track.run("timeline", lambda: timeline.run(ctx, rb))
        repo.save_timeline(attempt["id"], tl)

        ev = track.run("evaluate", lambda: evaluate.run(ctx, rb, tl))
        repo.save_evaluation(attempt["id"], video["id"], ev)

        summary: PoseSummary | None = track.run("pose", lambda: _join_pose(pose_future))
        track.run("roles", lambda: pose.assign_roles(ctx, ev.people))

        # Pose candidates are made before roles are known. Now that tracks have roles, name the
        # person, and keep caregiver-posture readings out of the patient check: they stay advisory.
        candidates = pose.relabel_flags(video["id"], summary.candidate_flags) if summary else []
        about_patient = [f for f in candidates if f.kind != "unsafe_caregiver_posture"]
        about_caregiver = [f for f in candidates if f.kind == "unsafe_caregiver_posture"]
        confirmed = track.run("confirm_flags", lambda: evaluate.confirm_pose_flags(ctx, rb, about_patient))
        pose_flags = (confirmed if confirmed is not None else about_patient) + about_caregiver
        repo.save_flags(video["id"], attempt["id"], pose_flags, sources=("pose", "pose_confirmed"))

        flags = repo.get_flags(attempt["id"])
        sc = track.run("score", lambda: scoring.score(rb, tl, ev, flags))
        repo.save_score(attempt["id"], sc)
        repo.update_job(job_id, status="done", stage="done", error=None)
    except Exception as exc:
        repo.update_job(job_id, status="error", error=f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-1500:]}")


def submit_reference(video_id, slug: str | None = None, name: str | None = None):
    job_id = repo.create_job("reference", video_id)
    _jobs.submit(run_reference, job_id, slug, name)
    return job_id


def submit_attempt(attempt_id, video_id, skill_id):
    job_id = repo.create_job("attempt", video_id, skill_id=skill_id, attempt_id=attempt_id)
    _jobs.submit(run_attempt, job_id)
    return job_id


def ingest(src_path: str, kind: str, original_name: str) -> dict:
    """Normalise an uploaded or reference file into data/videos and create its row."""
    import uuid

    config.ensure_dirs()
    video_id = uuid.uuid4()
    dst = media.video_path(video_id)
    info = media.normalize(src_path, dst)
    if info["duration_s"] < config.MIN_VIDEO_SECONDS:
        dst.unlink(missing_ok=True)
        raise media.MediaError(
            f"That file is only {info['duration_s']:.1f} seconds long. Record at least "
            f"{config.MIN_VIDEO_SECONDS:.0f} seconds of video.")
    return repo.create_video(kind, str(dst), original_name, info, video_id=video_id)


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)
