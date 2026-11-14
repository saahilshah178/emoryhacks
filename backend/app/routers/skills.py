"""Skills and their rubrics. Owned by branch feat/rubric.

GET    /api/skills                         newest version of each skill (?all=1 for every version)
GET    /api/skills/{id}                    skill with steps (evals included), reference video and latest_id
PATCH  /api/skills/{id}                    edit name / summary / order_matters / safety_criteria
PATCH  /api/skills/{id}/steps/{step_id}    edit a step's text, flags, times or evals
POST   /api/skills/{id}/regenerate         rebuild the rubric from the reference video as a NEW version;
                                           returns {job_id}; when done, the job's skill_id is the new version
DELETE /api/skills/{id}
GET    /api/skills/{id}/policy             the nurse's rules for the skill and where each caregiver stands (nurse)
PUT    /api/skills/{id}/policy             body {max_attempts, submit_pct, force_pct, assign_all, assigned_ids?}
                                           -> the same shape as GET (nurse)

A policy belongs to the skill's slug, so it carries over to every version of the skill. Its
fields: max_attempts (1..50, or null for unlimited, the default), submit_pct (default 80: the
score at which a caregiver can send an attempt), force_pct (default 50: from here up to
submit_pct they can send it anyway with a note), assign_all (default true: every caregiver of
the agency has the skill; false: only the caregivers picked). 0 <= force_pct <= submit_pct <= 100.
Fields left out of a PUT keep their value. assigned_ids replaces the picked caregivers when
assign_all is false; switching assign_all off without it keeps whoever was picked before.
One caregiver's assignment and limit are changed with PATCH /api/caregivers/{id}/skills/{skill_id}.

Lists include each skill's policy {max_attempts, submit_pct, force_pct, assign_all, assigned_count}
and submission_count (attempts at this version sent to a nurse). A caregiver sees only the skills
assigned to them: any other is a 404.
"""
from __future__ import annotations

import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth, builtin, config, gemini, jobs, media, progress, repo
from ..models import Classification, SkillPatch, StepPatch
from ..stages import rubric

router = APIRouter(prefix="/skills", tags=["skills"])

# One rubric regeneration at a time: each one is a few Gemini calls on a whole video.
_regenerate_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="regenerate")
REGENERATE_STAGES = ["gemini_upload", "rubric"]
# slug -> job id of the rebuild in progress, so a double click does not start two.
_rebuilding: dict[str, object] = {}
_rebuilding_lock = threading.Lock()


class PolicyUpdate(BaseModel):
    max_attempts: int | None = None
    submit_pct: float | None = None
    force_pct: float | None = None
    assign_all: bool | None = None
    assigned_ids: list[uuid.UUID] | None = None


@router.get("")
def list_skills(all: bool = False, user: dict = Depends(auth.current_user)):
    """The newest version of each of the agency's skills, or every version with ?all=1.
    A caregiver gets only the skills assigned to them."""
    skills = repo.list_skills(all_versions=all, org_id=user["org_id"])
    if user["role"] == "caregiver":
        assigned = repo.assigned_slugs(user["org_id"], user["id"])
        skills = [s for s in skills if s["slug"] in assigned]
    return skills


@router.get("/{skill_id}")
def get_skill(skill_id: str, user: dict = Depends(auth.current_user)):
    skill = _skill_or_404(skill_id, user)
    pol = repo.get_policy(skill["org_id"], skill["slug"])
    skill["policy"] = {k: pol[k] for k in ("max_attempts", "submit_pct", "force_pct", "assign_all")}
    return repo.public(skill)


@router.get("/{skill_id}/policy")
def get_policy(skill_id: str, user: dict = Depends(auth.nurse)):
    return _policy_view(_skill_or_404(skill_id, user))


@router.put("/{skill_id}/policy")
def put_policy(skill_id: str, body: PolicyUpdate, user: dict = Depends(auth.nurse)):
    skill = _skill_or_404(skill_id, user)
    org, slug = skill["org_id"], skill["slug"]
    pol = repo.get_policy(org, slug)
    given = body.model_fields_set
    if "max_attempts" in given:  # null is unlimited
        pol["max_attempts"] = body.max_attempts
    for key in ("submit_pct", "force_pct", "assign_all"):
        if key in given and getattr(body, key) is not None:
            pol[key] = getattr(body, key)
    limit = progress.MAX_ATTEMPTS
    if pol["max_attempts"] is not None and not 1 <= pol["max_attempts"] <= limit:
        raise HTTPException(422, f"Attempts allowed must be a whole number from 1 to {limit}, or unlimited.")
    if not 0 <= pol["submit_pct"] <= 100:
        raise HTTPException(422, "The score needed to send a recording must be between 0% and 100%.")
    if not 0 <= pol["force_pct"] <= pol["submit_pct"]:
        raise HTTPException(422, "The score needed to send a recording anyway must be between 0% and the "
                                 "score needed to send it normally.")
    caregivers = {c["id"] for c in repo.list_caregivers(org)}
    picked = set(body.assigned_ids or [])
    if picked - caregivers:
        raise HTTPException(422, "Some of the chosen caregivers are not caregivers in this agency.")
    repo.save_policy(org, slug, pol, updated_by=user["id"])
    if not pol["assign_all"] and body.assigned_ids is not None:
        for person_id in caregivers:
            repo.set_assignment(org, slug, person_id, assigned=person_id in picked)
    return _policy_view(skill)


def _policy_view(skill: dict) -> dict:
    """The skill's policy and, for every caregiver of the agency, their assignment, limit,
    attempts used / allowed / left and standing on the skill."""
    org, slug = skill["org_id"], skill["slug"]
    pol = repo.get_policy(org, slug)
    assignments = repo.get_assignments(org, slug=slug)
    attempts: dict = {}
    for a in sorted(repo.list_attempts(org_id=org, slug=slug), key=lambda a: a["created_at"]):
        attempts.setdefault(a["caregiver_id"], []).append(a)
    caregivers = []
    for person in repo.list_caregivers(org):
        standing = progress.caregiver_skill(pol, assignments.get((slug, person["id"])), attempts.get(person["id"], []),
                                            person["skill_attempt_limit"])
        caregivers.append({"id": person["id"], "name": person["name"], "title": person["title"],
                           "skill_attempt_limit": person["skill_attempt_limit"],
                           **{k: standing[k] for k in ("assigned", "limit_mode", "max_attempts", "attempts_used",
                                                      "attempts_allowed", "attempts_left", "state")}})
    return {"skill_id": skill["id"], "slug": slug, **pol, "caregivers": caregivers}


@router.patch("/{skill_id}")
def patch_skill(skill_id: str, body: SkillPatch, user: dict = Depends(auth.nurse)):
    skill = _skill_or_404(skill_id, user)
    fields = body.model_dump(exclude_none=True)
    if body.guide is not None:  # merge, and drop keys set to null or "" so they fall back to the rubric
        own = {**(skill_guide_own(skill_id)), **body.guide}
        fields["guide"] = {k: v for k, v in own.items() if v not in (None, "", [])}
    repo.patch_skill(skill_id, fields)
    return repo.public(repo.get_skill(skill_id))


def skill_guide_own(skill_id) -> dict:
    from .. import db

    row = db.fetch_one("SELECT guide FROM skills WHERE id=%s", (skill_id,))
    return (row or {}).get("guide") or {}


@router.patch("/{skill_id}/steps/{step_id}")
def patch_step(skill_id: str, step_id: str, body: StepPatch, user: dict = Depends(auth.nurse)):
    skill = _skill_or_404(skill_id, user)
    step = next((s for s in skill["steps"] if s["step_id"] == step_id), None)
    if step is None:
        raise HTTPException(404, "Step not found")
    # Times are checked only when the edit changes them, so a step that is not timed yet
    # (start = end = 0) can still have its text and criteria edited.
    if body.start_s is not None or body.end_s is not None:
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
    return repo.public(repo.get_skill(skill_id))


@router.post("/{skill_id}/regenerate")
def regenerate(skill_id: str, user: dict = Depends(auth.nurse)):
    """Start rebuilding the skill's rubric from its reference video.

    The result is stored as a NEW version of the skill; this version and the attempts graded
    against it are left untouched, so their results never end up under different steps.
    Returns {job_id}. When that job is done, its skill_id is the new version's id."""
    skill = _skill_or_404(skill_id, user)
    if not skill["video"]:
        raise HTTPException(409, "This skill has no reference video to rebuild from")
    try:
        repo.ensure_video_file(skill["video"])
    except media.MediaError as exc:
        raise HTTPException(409, str(exc)) from exc
    with _rebuilding_lock:
        key = f"{skill['org_id']}:{skill['slug']}"
        running = _rebuilding.get(key)
        if running:
            return {"job_id": running}
        job_id = repo.create_job("reference", skill["video"]["id"], skill_id=skill["id"])
        _rebuilding[key] = job_id
    _regenerate_pool.submit(_regenerate, job_id, skill)
    return {"job_id": job_id}


@router.delete("/{skill_id}")
def delete_skill(skill_id: str, user: dict = Depends(auth.nurse)):
    """Delete this version of the skill, with the attempts graded against it. The last
    version of a standard skill stays: the list caregivers work from never loses one."""
    skill = _skill_or_404(skill_id, user)
    if builtin.is_builtin(skill["slug"]) and len(skill["versions"]) <= 1:
        raise HTTPException(409, f"{skill['name']} is one of the standard skills, so its last version "
                                 "can't be deleted. You can edit its steps or record a new reference instead.")
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
        repo.update_job(job_id, status="error", error=jobs.failure_text(exc))
    finally:
        with _rebuilding_lock:
            _rebuilding.pop(f"{skill['org_id']}:{skill['slug']}", None)


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


def _skill_or_404(skill_id: str, user: dict) -> dict:
    try:
        skill = repo.get_skill(skill_id)
    except Exception:
        skill = None
    if not skill or skill["org_id"] != user["org_id"]:
        raise HTTPException(404, "Skill not found")
    if user["role"] == "caregiver" and skill["slug"] not in repo.assigned_slugs(user["org_id"], user["id"]):
        raise HTTPException(404, "Skill not found")
    return skill
