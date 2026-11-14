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

Spend. A job has an allowance: config.GEMINI_JOB_BUDGET_USD for an attempt,
GEMINI_REFERENCE_BUDGET_USD for a reference video. Stages mark their optional calls
(ctx.generate_json(..., optional=True)), and those are skipped once the job's recorded
spend plus the call's estimate would pass the allowance. No call at all is sent once the
job has spent GEMINI_JOB_HARD_LIMIT_FACTOR times its allowance.

Restarts. Each stage stores its result as it finishes (the timeline and the evaluation on
the attempt, the pose summary and a reference job's classification in the job's
checkpoint). When the server starts, resume_interrupted() picks up every job this machine
was running when it stopped and runs it again: finished stages are loaded instead of run,
and any Gemini request the job had already paid for is answered from the call log
(gemini._replay). After config.JOB_MAX_RESUMES resumes a job is marked as failed instead.
"""
from __future__ import annotations

import datetime as dt
import threading
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

_running: set[str] = set()  # ids of the jobs this process is running now
_running_lock = threading.Lock()


@dataclass
class StageContext:
    """What a stage needs: the video, the job, helpers for Gemini inputs, and the job's
    spending allowance. budget_usd defaults to the allowance for the job's kind (an attempt
    when attempt is set); with no job_id there is no allowance, as in scripts that run one
    stage on its own."""

    job_id: Any
    video: dict
    skill: dict | None = None
    attempt: dict | None = None
    slug_hint: str | None = None
    logs: list[str] = field(default_factory=list)
    budget_usd: float | None = None

    def __post_init__(self):
        if self.budget_usd is None and self.job_id is not None:
            self.budget_usd = (config.GEMINI_JOB_BUDGET_USD if self.attempt is not None
                               else config.GEMINI_REFERENCE_BUDGET_USD)
        self._file_lock = threading.Lock()

    @property
    def video_id(self):
        return self.video["id"]

    @property
    def path(self) -> str:
        return self.video["path"]

    @property
    def duration(self) -> float:
        return float(self.video.get("duration_s") or 0)

    @property
    def hard_limit_usd(self) -> float | None:
        return None if self.budget_usd is None else self.budget_usd * config.GEMINI_JOB_HARD_LIMIT_FACTOR

    def spent_usd(self) -> float:
        """What this job has spent on Gemini so far."""
        return gemini.job_spent_usd(self.job_id)

    def estimate(self, parts: list[dict], model: str = "main", output_tokens: int | None = None) -> float:
        """Rough cost of sending parts, with output_tokens of thinking and reply."""
        return gemini.estimate_usd(parts, model, output_tokens or gemini.DEFAULT_EXPECTED_OUTPUT, self.duration)

    def affordable(self, estimate_usd: float) -> bool:
        """True when an optional call costing about estimate_usd fits in the job's allowance."""
        return self.budget_usd is None or self.spent_usd() + estimate_usd <= self.budget_usd

    def video_part(self, **kwargs) -> dict:
        """A Gemini video input for this video. Accepts resolution, start_s, end_s, fps."""
        uri, mime = gemini.ensure_file(self.video)
        return gemini.video_part(uri, mime, **kwargs)

    def frame_jpeg(self, t: float, width: int = 960) -> bytes:
        return media.frame_jpeg(self.path, t, width)

    def _guarded(self, purpose: str, parts: list[dict], model: str, optional: bool,
                 expect_output_tokens: int | None, send: Callable[[list[dict]], Any]) -> Any:
        if optional:
            estimate = self.estimate(parts, model, expect_output_tokens)
            if not self.affordable(estimate):
                raise gemini.SkippedForBudget(
                    f"{purpose} skipped: the job has spent ${self.spent_usd():.3f} of its "
                    f"${self.budget_usd:.2f} allowance and this call would cost about ${estimate:.3f}")
        try:
            return send(parts)
        except gemini.FileUnavailable:
            # The cached upload expired or was deleted early: upload once more and repeat the call.
            failing = next((p.get("uri") for p in parts if p.get("type") == "video"), None)
            with self._file_lock:
                if self.video.get("gemini_file_uri") == failing:
                    gemini.ensure_file(self.video, force=True)
            self.log(f"{purpose}: the uploaded video had expired, so it was uploaded again")
            return send(gemini.with_uri(parts, failing, self.video["gemini_file_uri"]))

    def generate_json(self, purpose: str, parts: list[dict], schema, *, optional: bool = False,
                      expect_output_tokens: int | None = None, **kwargs):
        """gemini.generate_json with this job and video on the call log and the job's ceiling
        applied. optional=True skips the call (raising gemini.SkippedForBudget) when its estimate,
        with expect_output_tokens of thinking and reply, does not fit in what is left of the
        job's allowance."""
        return self._guarded(purpose, parts, kwargs.get("model", "main"), optional, expect_output_tokens,
                             lambda p: gemini.generate_json(purpose, p, schema, job_id=self.job_id,
                                                            video_id=self.video_id,
                                                            job_cap_usd=self.hard_limit_usd, **kwargs))

    def generate_text(self, purpose: str, parts: list[dict], *, optional: bool = False,
                      expect_output_tokens: int | None = None, **kwargs) -> str:
        """gemini.generate_text with this job and video on the call log (see generate_json)."""
        return self._guarded(purpose, parts, kwargs.get("model", "main"), optional, expect_output_tokens,
                             lambda p: gemini.generate_text(purpose, p, job_id=self.job_id, video_id=self.video_id,
                                                            job_cap_usd=self.hard_limit_usd, **kwargs))

    def log(self, message: str) -> None:
        self.logs.append(message)


class Tracker:
    """Records per-stage status on the jobs row. previous is the stage list of an interrupted
    run of the same job: the stages it finished stay finished (see completed)."""

    def __init__(self, job_id, names: list[str], previous: list[dict] | None = None):
        self.job_id = job_id
        before = {s.get("name"): s for s in previous or []}
        self.stages = []
        for n in names:
            old = before.get(n)
            if old and (old.get("status") == "done" or (n in ADVISORY_STAGES and old.get("status") == "error")):
                self.stages.append({**old, "resumed": True})
            else:
                self.stages.append({"name": n, "status": "pending", "seconds": None, "error": None})
        repo.update_job(job_id, status="running", stage=names[0], stages=self.stages, error=None)

    def completed(self, name: str) -> bool:
        """True when an earlier run of this job finished the stage (an advisory stage may have
        finished with an error, which that run carried on from)."""
        entry = next(s for s in self.stages if s["name"] == name)
        return bool(entry.get("resumed"))

    def run(self, name: str, fn: Callable[[], Any]) -> Any:
        entry = next(s for s in self.stages if s["name"] == name)
        entry.update(status="running", error=None)
        entry.pop("resumed", None)
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


# First lines of job errors that mean the AI account itself needs attention (see repo.ai_problem).
AI_OUT_OF_CREDIT = "The AI service account has run out of credit, so the video could not be checked."
AI_OVER_BUDGET = "This server has reached its AI spending limit, so the video could not be checked."
AI_KEY_REJECTED = "The AI service rejected this server's API key, so the video could not be checked."
# First lines for a single job that was stopped; they do not mean the account needs attention.
JOB_OVER_CEILING = ("Checking this video cost more than one video is allowed to, so it was stopped "
                    "before it finished. A nurse can still review the recording.")
TOO_MANY_RESTARTS = ("The server restarted {n} times while this video was being checked, so checking was "
                     "stopped. Please send the video again.")


def failure_text(exc: Exception) -> str:
    """What to store as a failed job's error: a sentence a caregiver or nurse can read on the
    first line, then the technical detail for whoever looks into it."""
    raw = f"{type(exc).__name__}: {exc}"
    if isinstance(exc, gemini.BudgetExceeded):
        first = f"{AI_OVER_BUDGET} Raise GEMINI_BUDGET_USD to carry on."
    elif isinstance(exc, gemini.JobBudgetExceeded):
        first = JOB_OVER_CEILING
    elif "RESOURCE_EXHAUSTED" in raw or "credits are depleted" in raw:
        first = f"{AI_OUT_OF_CREDIT} Top up the Gemini account, then send the video again."
    elif "API_KEY_INVALID" in raw or "PERMISSION_DENIED" in raw or "API key not valid" in raw:
        first = f"{AI_KEY_REJECTED} Check GEMINI_API_KEY."
    elif isinstance(exc, media.MediaError):
        first = str(exc)
    else:
        first = "Something went wrong while checking the video. Please send it again."
    return f"{first}\n{raw}\n{traceback.format_exc()[-1500:]}"


def _start_pose(ctx: StageContext) -> Future | None:
    if not config.POSE_ENABLED:
        return None
    from .stages import pose

    return _pose.submit(pose.extract, ctx)


def _join_pose(future: Future | None) -> PoseSummary:
    if future is None:
        return PoseSummary(note="pose disabled")
    return future.result(timeout=3600)


def _pose_stage(job_id, future: Future | None) -> PoseSummary:
    """Wait for pose extraction and keep its summary for a resumed run (the frames are in Tiger)."""
    summary = _join_pose(future)
    repo.save_checkpoint(job_id, pose=summary.model_dump())
    return summary


def _saved_pose(checkpoint: dict) -> PoseSummary | None:
    saved = checkpoint.get("pose")
    return PoseSummary(**saved) if saved else None


def _as_named(detected: Classification, slug: str | None, name: str | None) -> Classification:
    """The classification with a forced slug and name applied (and the catalog's category)."""
    if not slug or slug == detected.skill_slug:
        return detected
    from . import catalog

    known = catalog.BY_SLUG.get(slug, {})
    return detected.model_copy(update={
        "skill_slug": slug,
        "skill_name": name or known.get("name") or detected.skill_name,
        "category": known.get("category") or detected.category,
    })


class _Running:
    """Marks a job as run by this process for as long as the with-block lasts, so that
    resume_interrupted never starts a second copy of it."""

    def __init__(self, job_id):
        self.key = str(job_id)

    def __enter__(self):
        with _running_lock:
            _running.add(self.key)

    def __exit__(self, *exc):
        with _running_lock:
            _running.discard(self.key)


def run_reference(job_id, slug: str | None = None, name: str | None = None) -> None:
    """Run the nurse-side pipeline. slug/name force the stored skill's identity
    (used when seeding known reference videos); the classifier still runs.
    A resumed job takes slug and name from its checkpoint."""
    from .stages import classify, pose, rubric

    with _Running(job_id):
        try:  # setup is inside the try so that a failure here marks the job instead of leaving it queued
            job = repo.get_job(job_id)
            resumed = bool(job.get("resumes"))
            checkpoint = job.get("checkpoint") or {}
            if resumed:
                slug, name = checkpoint.get("slug", slug), checkpoint.get("name", name)
            else:
                repo.save_checkpoint(job_id, slug=slug, name=name)
            video = repo.ensure_video_file(repo.get_video(job["video_id"]))
            ctx = StageContext(job_id=job_id, video=video, slug_hint=slug)
            track = Tracker(job_id, REFERENCE_STAGES, job["stages"] if resumed else None)
            pose_future = None if track.completed("pose") else _start_pose(ctx)
            track.run("gemini_upload", lambda: None if config.FAKE_AI else gemini.ensure_file(video, verify=resumed))

            def classify_stage() -> Classification:
                found = classify.run(ctx)
                repo.save_checkpoint(job_id, detected=found.model_dump())
                return found

            if track.completed("classify") and checkpoint.get("detected"):
                detected = Classification(**checkpoint["detected"])
            else:
                detected = track.run("classify", classify_stage)
            # When the skill is named up front (seeding), write the rubric for that skill, not for
            # whatever the classifier guessed. What the classifier detected is still stored.
            classification = _as_named(detected, slug, name)

            def rubric_stage() -> None:
                rb = rubric.run(ctx, classification)
                repo.update_job(job_id, skill_id=repo.create_skill(detected, rb, video["id"], slug=slug, name=name))

            if not (track.completed("rubric") and job.get("skill_id")):
                track.run("rubric", rubric_stage)
            if track.completed("pose"):
                summary = _saved_pose(checkpoint)
            else:
                summary = track.run("pose", lambda: _pose_stage(job_id, pose_future))
            if not track.completed("roles"):
                track.run("roles", lambda: pose.assign_roles(ctx, classification.people))
            if summary and summary.candidate_flags:  # advisory only: a reference video is never scored
                repo.save_flags(video["id"], None, pose.relabel_flags(video["id"], summary.candidate_flags),
                                sources=("pose", "pose_confirmed"))
            repo.update_job(job_id, status="done", stage="done", error=None)
        except Exception as exc:
            repo.update_job(job_id, status="error", error=failure_text(exc))


def run_attempt(job_id) -> None:
    """Run the caregiver-side pipeline for an attempt. A resumed job loads what its interrupted
    run finished (repo.load_timeline, repo.load_evaluation, the pose summary) instead of
    running those stages again."""
    from .stages import evaluate, pose, scoring, timeline

    with _Running(job_id):
        try:  # setup is inside the try so that a failure here marks the job instead of leaving it queued
            job = repo.get_job(job_id)
            resumed = bool(job.get("resumes"))
            checkpoint = job.get("checkpoint") or {}
            video = repo.ensure_video_file(repo.get_video(job["video_id"]))
            attempt = repo.get_attempt(job["attempt_id"])
            skill = repo.get_skill(attempt["skill_id"])
            rb = repo.get_rubric(attempt["skill_id"])
            ctx = StageContext(job_id=job_id, video=video, skill=skill, attempt=attempt)
            track = Tracker(job_id, ATTEMPT_STAGES, job["stages"] if resumed else None)
            pose_future = None if track.completed("pose") else _start_pose(ctx)
            track.run("gemini_upload", lambda: None if config.FAKE_AI else gemini.ensure_file(video, verify=resumed))

            def timeline_stage():
                result = timeline.run(ctx, rb)
                repo.save_timeline(attempt["id"], result)
                return result

            def evaluate_stage():
                result = evaluate.run(ctx, rb, tl)
                repo.save_evaluation(attempt["id"], video["id"], result)
                return result

            tl = repo.load_timeline(attempt["id"]) if track.completed("timeline") else track.run("timeline", timeline_stage)
            ev = (repo.load_evaluation(attempt["id"]) if track.completed("evaluate")
                  else track.run("evaluate", evaluate_stage))

            if track.completed("pose"):
                summary = _saved_pose(checkpoint)
            else:
                summary = track.run("pose", lambda: _pose_stage(job_id, pose_future))
            # A video of another skill fails whatever its pose shows: no Gemini calls for roles or flags.
            if not track.completed("roles"):
                track.run("roles", lambda: pose.assign_roles(ctx, ev.people) if ev.skill_match else None)

            def confirm_stage() -> None:
                # Pose candidates are made before roles are known. Now that tracks have roles, name
                # the person. Only readings about a patient go to Gemini for confirmation; a
                # caregiver's posture and readings from someone whose role is unknown stay advisory.
                candidates = pose.relabel_flags(video["id"], summary.candidate_flags) if summary else []
                about_patient = [f for f in candidates if f.kind.startswith("patient_")]
                advisory = [f for f in candidates if not f.kind.startswith("patient_")]
                error = None
                try:
                    confirmed = evaluate.confirm_pose_flags(ctx, rb, about_patient) if ev.skill_match else about_patient
                except Exception as exc:  # the flags are stored unconfirmed
                    confirmed, error = about_patient, exc
                repo.save_flags(video["id"], attempt["id"], confirmed + advisory, sources=("pose", "pose_confirmed"))
                if error is not None:
                    raise error

            if not track.completed("confirm_flags"):
                track.run("confirm_flags", confirm_stage)

            flags = repo.get_flags(attempt["id"])
            sc = track.run("score", lambda: scoring.score(rb, tl, ev, flags))
            repo.save_score(attempt["id"], sc)
            repo.update_job(job_id, status="done", stage="done", error=None)
        except Exception as exc:
            repo.update_job(job_id, status="error", error=failure_text(exc))


def submit_reference(video_id, slug: str | None = None, name: str | None = None):
    job_id = repo.create_job("reference", video_id)
    _jobs.submit(run_reference, job_id, slug, name)
    return job_id


def submit_attempt(attempt_id, video_id, skill_id):
    job_id = repo.create_job("attempt", video_id, skill_id=skill_id, attempt_id=attempt_id)
    _jobs.submit(run_attempt, job_id)
    return job_id


def _is_rebuild(job: dict) -> bool:
    """A "Rebuild steps" job (routers/skills.py): a reference job on an existing skill, with no classify stage."""
    names = {s.get("name") for s in job.get("stages") or []}
    return job["kind"] == "reference" and bool(job.get("skill_id")) and "classify" not in names


def _resume_rebuild(job_id) -> None:
    from .routers import skills as skills_router

    with _Running(job_id):
        job = repo.get_job(job_id)
        skill = repo.get_skill(job["skill_id"]) if job.get("skill_id") else None
        if not skill:
            repo.update_job(job_id, status="error", error="The skill this rebuild was for no longer exists.")
            return
        skills_router._regenerate(job_id, skill)  # its finished Gemini calls are answered from the call log


def resume_interrupted(submit: Callable[..., Future] | None = None) -> list[tuple[Any, Future]]:
    """Run again every job this machine was running when its server stopped. Called at server start.

    Jobs of another live process are left alone (repo.interrupted_jobs). A job from another
    machine that has made no progress for two hours is marked as interrupted, because its
    video file is on that machine. A job already resumed config.JOB_MAX_RESUMES times is
    marked as failed. Returns (job_id, future) for each job submitted again."""
    submit = submit or _jobs.submit
    with _running_lock:
        mine = set(_running)
    here, elsewhere = repo.interrupted_jobs(skip=mine)
    for job in elsewhere:
        repo.update_job(job["id"], status="error", error=repo.INTERRUPTED)
    resumed = []
    for job in here:
        if (job.get("resumes") or 0) >= config.JOB_MAX_RESUMES:
            repo.update_job(job["id"], status="error",
                            error=TOO_MANY_RESTARTS.format(n=job["resumes"] + 1)
                            + f"\nResumed {job['resumes']} times already (FIRSTSHIFT_JOB_MAX_RESUMES).")
            continue
        if not repo.claim_job(job):
            continue  # another process took it first
        if job["kind"] == "attempt":
            resumed.append((job["id"], submit(run_attempt, job["id"])))
        elif _is_rebuild(job):
            resumed.append((job["id"], submit(_resume_rebuild, job["id"])))
        else:
            resumed.append((job["id"], submit(run_reference, job["id"])))
    return resumed


def ingest(src_path: str, kind: str, original_name: str, org_id=None, uploaded_by=None) -> dict:
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
    return repo.create_video(kind, str(dst), original_name, info, video_id=video_id,
                             org_id=org_id, uploaded_by=uploaded_by)


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)
