"""The nine standard skills every agency starts with.

Their steps, criteria and step times are kept in builtin_skills.json, next to this file, so
they are the same on every database and need no Gemini call to set up. The reference videos
are the files in reference_vids/, which the API turns into playable MP4s on first use
(repo.ensure_video_file).

  ensure(org_id)   bring the agency's standard skills up to the file. Run at API start.
  export(org_id)   the agency's current version of each standard skill, in the file's shape.

Each skill in the file has a revision, and "replaces": the fingerprints (fingerprint()) of the
content of its earlier revisions. ensure() installs a skill the agency has no version of, and
installs a revised one as a NEW version, on the same reference video, when the agency's newest
version is an earlier revision exactly: same reference file, and same name, summary, safety
points, notes, steps, times and criteria. The older version stays as it was, with the attempts
graded against it.

The content is compared rather than ids or timestamps because revision 1 was exported from a
database whose skills were built by the rubric stage (random ids, any version number), and
because a nurse's change to the caregiver copy or a save that changed nothing also moves
updated_at. Anything a nurse has done to the rubric makes the version hers, and it is then
left alone: an edit to its steps or wording changes the fingerprint, a rebuilt rubric is a
newer version with the rubric stage's own wording, and a new reference is a different video.
Her caregiver-facing copy (skills.guide) is not part of the fingerprint; it is carried over to
the new version, as repo.create_skill does when a nurse rebuilds a skill. Each revision is
installed only once per agency
(builtin_installs), so a version a nurse deletes does not come back at the next start. What a
nurse cannot do is delete the last version of a standard skill (see routers/skills.py), so the
list a caregiver sees never loses one of them. Skills a nurse records herself are not touched
by any of this; they go through the classify and rubric stages as before.

To refresh the file from a database whose rubrics you are happy with:
  uv run python -m scripts.builtin_skills export
"""
from __future__ import annotations

import hashlib
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
                "must_follow", "applies_when", "evals")

# What a fingerprint covers: everything grading reads and a nurse can change, except the guide.
_FINGERPRINT_FIELDS = ("name", "category", "summary", "order_matters", "safety_criteria", "people", "notes")
_EVAL_LISTS = ("pass_criteria", "fail_criteria", "unverified_when", "visual_cues")


def is_builtin(slug: str) -> bool:
    return slug in SLUGS


def load() -> list[dict]:
    """The standard skills as stored in the file, in catalog order."""
    skills = json.loads(FILE.read_text())["skills"]
    by_slug = {s["slug"]: s for s in skills}
    return [by_slug[slug] for slug in SLUGS if slug in by_slug]


def _id(org_id, kind: str, key: str) -> uuid.UUID:
    return uuid.uuid5(_NAMESPACE, f"{org_id}:{kind}:{key}")


def _skill_key(slug: str, revision: int) -> str:
    # Revision 1 was installed before revisions existed, under the bare slug.
    return slug if revision == 1 else f"{slug}:r{revision}"


def fingerprint(skill: dict, steps: list[dict]) -> str:
    """A short hash of a skill version's content: the fields in _FINGERPRINT_FIELDS and every
    step. skill is a skills row or an entry of the file, steps its skill_steps rows or the
    entry's steps, so a version in a database can be matched to a revision in the file. Times
    are rounded because the database keeps them as 4-byte floats."""
    content = {key: skill.get(key) for key in _FINGERPRINT_FIELDS}
    content["steps"] = [{
        "step_id": s["step_id"], "ord": s["ord"], "title": s["title"], "description": s["description"] or "",
        "start_s": round(float(s["start_s"]), 2), "end_s": round(float(s["end_s"]), 2),
        "critical": bool(s["critical"]), "order_dependent": bool(s["order_dependent"]),
        "must_follow": list(s["must_follow"] or []), "applies_when": (s.get("applies_when") or "").strip(),
        "evals": {key: list((s["evals"] or {}).get(key) or []) for key in _EVAL_LISTS},
    } for s in sorted(steps, key=lambda s: s["ord"])]
    text = json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def ensure(org_id=repo.DEFAULT_ORG) -> list[dict]:
    """Install every standard skill the agency has no version of, and every revised one whose
    newest version is an unchanged earlier revision. Returns what was installed, one
    {slug, name, version, revision, kind} each, kind "added" or "updated"; empty when nothing
    changed, so a second run returns [].

    Ids are derived from the agency, the slug and the revision, so two servers starting at once
    on the same database insert the same rows and the second one's inserts do nothing."""
    done = []
    for skill in load():
        with db.tx() as conn:
            change = _ensure_one(conn, org_id, skill)
        if change:
            done.append(change)
    return done


def describe(changes: list[dict]) -> list[str]:
    """One line per change from ensure(), for a log."""
    return [f"{c['name']}: {'installed' if c['kind'] == 'added' else 'updated to'} the standard rubric "
            f"(revision {c['revision']}) as version {c['version']}" for c in changes]


def _ensure_one(conn, org_id, skill: dict) -> dict | None:
    slug, revision, video = skill["slug"], skill["revision"], skill["video"]
    newest = conn.execute("SELECT * FROM skills WHERE org_id=%s AND slug=%s ORDER BY version DESC LIMIT 1",
                          (org_id, slug)).fetchone()
    if newest:
        steps = conn.execute("SELECT * FROM skill_steps WHERE skill_id=%s", (newest["id"],)).fetchall()
        if fingerprint(newest, steps) not in skill.get("replaces", []):
            return None  # this revision already, or a version a nurse has edited or rebuilt
        reference = conn.execute("SELECT original_name FROM videos WHERE id=%s",
                                 (newest["reference_video_id"],)).fetchone()
        if not reference or reference["original_name"] != video["original_name"]:
            return None  # a nurse recorded a new reference for it
        if conn.execute("SELECT 1 FROM builtin_installs WHERE org_id=%s AND slug=%s AND revision=%s",
                        (org_id, slug, revision)).fetchone():
            return None  # installed once already, and a nurse has since deleted it
        video_id = newest["reference_video_id"]
    else:
        video_id = _id(org_id, "video", slug)
        conn.execute(
            """INSERT INTO videos (id, kind, original_name, path, duration_s, width, height, fps, org_id)
               VALUES (%s,'reference',%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING""",
            (video_id, video["original_name"], repo.NO_FILE, video["duration_s"], video["width"],
             video["height"], video["fps"], org_id))
    key = _skill_key(slug, revision)
    skill_id, version = _id(org_id, "skill", key), (newest["version"] + 1 if newest else 1)
    # A new version keeps the caregiver-facing copy a nurse wrote for the one before it.
    guide = (newest["guide"] if newest else None) or skill.get("guide") or {}
    inserted = conn.execute(
        """INSERT INTO skills (id, slug, name, category, summary, version, order_matters, safety_criteria,
                               people, classification, notes, reference_video_id, org_id, guide)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
        (skill_id, slug, skill["name"], skill["category"], skill["summary"], version, skill["order_matters"],
         db.J(skill["safety_criteria"]), db.J(skill["people"]), db.J(skill["classification"]),
         skill["notes"], video_id, org_id, db.J(guide))).rowcount
    if not inserted:
        return None  # another server got there first, or a nurse's new version took the number
    for step in skill["steps"]:
        conn.execute(
            """INSERT INTO skill_steps (id, skill_id, step_id, ord, title, description, start_s, end_s,
                                        critical, order_dependent, must_follow, evals, applies_when)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (_id(org_id, "step", f"{key}:{step['step_id']}"), skill_id, step["step_id"], step["ord"],
             step["title"], step["description"], step["start_s"], step["end_s"], step["critical"],
             step["order_dependent"], db.J(step["must_follow"]), db.J(step["evals"]),
             (step.get("applies_when") or "").strip()))
    conn.execute(
        """INSERT INTO builtin_installs (org_id, slug, revision, skill_id) VALUES (%s,%s,%s,%s)
           ON CONFLICT (org_id, slug, revision) DO UPDATE SET skill_id=EXCLUDED.skill_id, installed_at=now()""",
        (org_id, slug, revision, skill_id))
    return {"slug": slug, "name": skill["name"], "version": version, "revision": revision,
            "kind": "updated" if newest else "added"}


def export(org_id=repo.DEFAULT_ORG) -> list[dict]:
    """The agency's newest version of each standard skill, in the shape of the file.

    A skill whose content differs from the file's gets the next revision, with the file's
    content added to "replaces", so databases still on the file's version are given it.
    Raises ValueError when the database holds an older revision than the file: exporting it
    would undo an improvement. Start the API or run `make skills` first."""
    current = {s["slug"]: s for s in load()}
    newest = {s["slug"]: s["id"] for s in repo.list_skills(org_id=org_id)}
    out = []
    for slug in SLUGS:
        if slug not in newest:
            raise KeyError(f"this agency has no skill with the slug {slug}")
        skill = repo.get_skill(newest[slug])
        if not skill["video"]:
            raise KeyError(f"{slug} has no reference video")
        entry = {"slug": slug, "revision": 1, "replaces": []}
        entry.update({key: skill[key] for key in _SKILL_FIELDS if key != "guide"})
        # Only the copy a nurse wrote herself; the rest of the guide is derived from the rubric.
        entry["guide"] = (db.fetch_one("SELECT guide FROM skills WHERE id=%s", (skill["id"],)) or {}).get("guide") or {}
        entry["video"] = {key: skill["video"][key] for key in _VIDEO_FIELDS}
        entry["steps"] = [{key: step[key] for key in _STEP_FIELDS} for step in skill["steps"]]
        before = current.get(slug)
        if before:
            mine, theirs = fingerprint(entry, entry["steps"]), fingerprint(before, before["steps"])
            if mine in before.get("replaces", []):
                raise ValueError(f"{slug}: this database has an older revision than the file")
            entry["revision"], entry["replaces"] = before["revision"], list(before.get("replaces", []))
            if mine != theirs:
                entry["revision"] += 1
                entry["replaces"].append(theirs)
        out.append(entry)
    return out
