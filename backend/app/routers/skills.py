"""Skills and their rubrics. Owned by branch feat/rubric.

GET    /api/skills                         newest version of each skill (?all=1 for every version)
GET    /api/skills/{id}                    skill with steps (evals included), reference video and latest_id
PATCH  /api/skills/{id}                    edit name / summary / order_matters / safety_criteria
PATCH  /api/skills/{id}/steps/{step_id}    edit a step's text, flags, times or evals
POST   /api/skills/{id}/regenerate         rebuild the rubric from the reference video as a NEW version;
                                           returns {job_id}; when done, the job's skill_id is the new version
DELETE /api/skills/{id}
"""
from __future__ import annotations

import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException

from .. import config, gemini, jobs, media, repo
from ..models import Classification, SkillPatch, StepPatch
from ..stages import rubric

router = APIRouter(prefix="/skills", tags=["skills"])

# One rubric regeneration at a time: each one is a few Gemini calls on a whole video.
_regenerate_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="regenerate")
REGENERATE_STAGES = ["gemini_upload", "rubric"]
# slug -> job id of the rebuild in progress, so a double click does not start two.
_rebuilding: dict[str, object] = {}
_rebuilding_lock = threading.Lock()


@router.get("")
def list_skills(all: bool = False):
    """The newest version of each skill, or every version with ?all=1."""
    return repo.list_skills(all_versions=all)


@router.get("/{skill_id}")
def get_skill(skill_id: str):
    skill = _skill_or_404(skill_id)
    return skill


@router.patch("/{skill_id}")
def patch_skill(skill_id: str, body: SkillPatch):
    _skill_or_404(skill_id)
    repo.patch_skill(skill_id, body.model_dump(exclude_none=True))
    return repo.get_skill(skill_id)


@router.patch("/{skill_id}/steps/{step_id}")
def patch_step(skill_id: str, step_id: str, body: StepPatch):
    skill = _skill_or_404(skill_id)
    step = next((s for s in skill["steps"] if s["step_id"] == step_id), None)
    if step is None:
        raise HTTPException(404, "Step not found")
    start = body.start_s if body.start_s is not None else step["start_s"]
    end = body.end_s if body.end_s is not None else step["end_s"]
    if start < 0 or end <= start:
        raise HTTPException(422, "A step must end after it starts, and start at 0 seconds or later")
    fields = body.model_dump(exclude_none=True)
    if body.must_follow is not None:
        earlier = {s["step_id"] for s in skill["steps"] if s["ord"] < step["ord"]}
        unknown = [m for m in body.must_follow if m not in earlier]
        if unknown:
            raise HTTPException(422, f"A step can only come after earlier steps; not allowed: {', '.join(unknown)}")
        fields["must_follow"] = list(dict.fromkeys(body.must_follow))
        fields.setdefault("order_dependent", bool(fields["must_follow"]))
    if not repo.patch_step(skill_id, step_id, fields):
        raise HTTPException(400, "Nothing to change")
    return repo.get_skill(skill_id)


@router.post("/{skill_id}/regenerate")
def regenerate(skill_id: str):
    """Start rebuilding the skill's rubric from its reference video.

    The result is stored as a NEW version of the skill; this version and the attempts graded
    against it are left untouched, so their results never end up under different steps.
    Returns {job_id}. When that job is done, its skill_id is the new version's id."""
    skill = _skill_or_404(skill_id)
    if not skill["video"]:
        raise HTTPException(409, "This skill has no reference video to rebuild from")
    try:
        repo.ensure_video_file(skill["video"])
    except media.MediaError as exc:
        raise HTTPException(409, str(exc)) from exc
    with _rebuilding_lock:
        running = _rebuilding.get(skill["slug"])
        if running:
            return {"job_id": running}
        job_id = repo.create_job("reference", skill["video"]["id"], skill_id=skill["id"])
        _rebuilding[skill["slug"]] = job_id
    _regenerate_pool.submit(_regenerate, job_id, skill)
    return {"job_id": job_id}


@router.delete("/{skill_id}")
def delete_skill(skill_id: str):
    if not repo.delete_skill(skill_id):
        raise HTTPException(404, "Skill not found")
    return {"deleted": True}


def _regenerate(job_id, skill: dict) -> None:
    """Background job: run the rubric stage and store the result as a new skill version."""
    try:
        ctx = jobs.StageContext(job_id=job_id, video=skill["video"], skill=skill, slug_hint=skill["slug"])
        track = jobs.Tracker(job_id, REGENERATE_STAGES)
        track.run("gemini_upload", lambda: None if config.FAKE_AI else gemini.ensure_file(skill["video"]))
        classification = _classification(skill)
        rb = track.run("rubric", lambda: rubric.run(ctx, classification))
        new_id = repo.create_skill(classification, rb, skill["video"]["id"], slug=skill["slug"], name=skill["name"])
        repo.update_job(job_id, skill_id=new_id, status="done", stage="done", error=None)
    except Exception as exc:
        repo.update_job(job_id, status="error", error=f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-1500:]}")
    finally:
        with _rebuilding_lock:
            _rebuilding.pop(skill["slug"], None)


def _classification(skill: dict) -> Classification:
    """The stored classification, with the nurse's current name and summary for the skill."""
    stored = skill.get("classification") or {}
    try:
        base = Classification(**stored)
    except Exception:
        base = Classification(skill_slug=skill["slug"], skill_name=skill["name"], category=skill["category"],
                              confidence=1.0, summary="", people=repo.people_from(skill["people"]),
                              order_matters=skill["order_matters"])
    return base.model_copy(update={"skill_slug": skill["slug"], "skill_name": skill["name"],
                                   "summary": skill["summary"]})


def _skill_or_404(skill_id: str) -> dict:
    try:
        skill = repo.get_skill(skill_id)
    except Exception:
        skill = None
    if not skill:
        raise HTTPException(404, "Skill not found")
    return skill
