"""Skills and their rubrics. Owned by branch feat/rubric.

GET    /api/skills                         list
GET    /api/skills/{id}                    skill with steps (evals included) and reference video
PATCH  /api/skills/{id}                    edit name / summary / order_matters / safety_criteria
PATCH  /api/skills/{id}/steps/{step_id}    edit a step's text, flags, times or evals
DELETE /api/skills/{id}
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import repo
from ..models import SkillPatch, StepPatch

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("")
def list_skills():
    return repo.list_skills()


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
    _skill_or_404(skill_id)
    if not repo.patch_step(skill_id, step_id, body.model_dump(exclude_none=True)):
        raise HTTPException(404, "Step not found or nothing to change")
    return repo.get_skill(skill_id)


@router.delete("/{skill_id}")
def delete_skill(skill_id: str):
    if not repo.delete_skill(skill_id):
        raise HTTPException(404, "Skill not found")
    return {"deleted": True}


def _skill_or_404(skill_id: str) -> dict:
    try:
        skill = repo.get_skill(skill_id)
    except Exception:
        skill = None
    if not skill:
        raise HTTPException(404, "Skill not found")
    return skill
