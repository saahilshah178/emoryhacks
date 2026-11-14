"""The nine standard skills every agency starts with.

Their steps, criteria and step times are kept in builtin_skills.json, next to this file, so
they are the same on every database and need no Gemini call to set up. The reference videos
are the files in reference_vids/, which the API turns into playable MP4s on first use
(repo.ensure_video_file).

  ensure(org_id)   add any standard skill the agency does not have yet. Run at API start.
  export(org_id)   the agency's current version of each standard skill, in the file's shape.

A standard skill is installed once, as version 1. After that it is an ordinary skill: a nurse
can edit its steps, rebuild it as a new version or record a new reference for it. What a
nurse cannot do is delete the last version of one (see routers/skills.py), so the list a
caregiver sees never loses one of them. Skills a nurse records herself are not touched by
any of this; they go through the classify and rubric stages as before.

To refresh the file from a database whose rubrics you are happy with:
  uv run python -m scripts.builtin_skills export
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from . import catalog, db, repo

FILE = Path(__file__).with_name("builtin_skills.json")
SLUGS = tuple(catalog.REFERENCE_FILES)
_NAMESPACE = uuid.UUID("6f1d3c52-8a0b-4e57-9d43-2b7c1a9e5f10")

_SKILL_FIELDS = ("slug", "name", "category", "summary", "order_matters", "safety_criteria", "people",
                 "classification", "notes", "guide")
_VIDEO_FIELDS = ("original_name", "duration_s", "width", "height", "fps")
_STEP_FIELDS = ("step_id", "ord", "title", "description", "start_s", "end_s", "critical", "order_dependent",
                "must_follow", "evals")


def is_builtin(slug: str) -> bool:
    return slug in SLUGS


def load() -> list[dict]:
    """The standard skills as stored in the file, in catalog order."""
    skills = json.loads(FILE.read_text())["skills"]
    by_slug = {s["slug"]: s for s in skills}
    return [by_slug[slug] for slug in SLUGS if slug in by_slug]


def _id(org_id, kind: str, key: str) -> uuid.UUID:
    return uuid.uuid5(_NAMESPACE, f"{org_id}:{kind}:{key}")


def ensure(org_id=repo.DEFAULT_ORG) -> list[str]:
    """Install every standard skill the agency has no version of. Returns the slugs added.

    Ids are derived from the agency and the slug, so two servers starting at once on the same
    database insert the same rows and the second one's inserts do nothing."""
    added = []
    for skill in load():
        slug = skill["slug"]
        with db.tx() as conn:
            if conn.execute("SELECT 1 FROM skills WHERE org_id=%s AND slug=%s LIMIT 1", (org_id, slug)).fetchone():
                continue
            video, video_id, skill_id = skill["video"], _id(org_id, "video", slug), _id(org_id, "skill", slug)
            conn.execute(
                """INSERT INTO videos (id, kind, original_name, path, duration_s, width, height, fps, org_id)
                   VALUES (%s,'reference',%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING""",
                (video_id, video["original_name"], repo.NO_FILE, video["duration_s"], video["width"],
                 video["height"], video["fps"], org_id))
            inserted = conn.execute(
                """INSERT INTO skills (id, slug, name, category, summary, version, order_matters, safety_criteria,
                                       people, classification, notes, reference_video_id, org_id, guide)
                   VALUES (%s,%s,%s,%s,%s,1,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                (skill_id, slug, skill["name"], skill["category"], skill["summary"], skill["order_matters"],
                 db.J(skill["safety_criteria"]), db.J(skill["people"]), db.J(skill["classification"]),
                 skill["notes"], video_id, org_id, db.J(skill.get("guide") or {}))).rowcount
            if not inserted:
                continue
            for step in skill["steps"]:
                conn.execute(
                    """INSERT INTO skill_steps (id, skill_id, step_id, ord, title, description, start_s, end_s,
                                                critical, order_dependent, must_follow, evals)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (_id(org_id, "step", f"{slug}:{step['step_id']}"), skill_id, step["step_id"], step["ord"],
                     step["title"], step["description"], step["start_s"], step["end_s"], step["critical"],
                     step["order_dependent"], db.J(step["must_follow"]), db.J(step["evals"])))
            added.append(slug)
    return added


def export(org_id=repo.DEFAULT_ORG) -> list[dict]:
    """The agency's newest version of each standard skill, in the shape of the file."""
    newest = {s["slug"]: s["id"] for s in repo.list_skills(org_id=org_id)}
    out = []
    for slug in SLUGS:
        if slug not in newest:
            raise KeyError(f"this agency has no skill with the slug {slug}")
        skill = repo.get_skill(newest[slug])
        if not skill["video"]:
            raise KeyError(f"{slug} has no reference video")
        entry = {key: skill[key] for key in _SKILL_FIELDS if key != "guide"}
        # Only the copy a nurse wrote herself; the rest of the guide is derived from the rubric.
        entry["guide"] = (db.fetch_one("SELECT guide FROM skills WHERE id=%s", (skill["id"],)) or {}).get("guide") or {}
        entry["video"] = {key: skill["video"][key] for key in _VIDEO_FIELDS}
        entry["steps"] = [{key: step[key] for key in _STEP_FIELDS} for step in skill["steps"]]
        out.append(entry)
    return out
