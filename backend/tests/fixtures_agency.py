"""A throwaway agency for the policy and submission tests: its own nurse, caregivers and
skills, and attempts written straight to the database with the score a test needs (no
video file and no pipeline), so each test starts from a known state in a few milliseconds."""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app import auth, db, repo
from app.main import app
from app.models import Classification, Rubric, RubricStep, StepEval


def client_for(user_id) -> TestClient:
    client = TestClient(app)
    client.headers["authorization"] = f"Bearer {auth.create_session(user_id)}"
    return client


class Agency:
    def __init__(self, name: str = "Test agency"):
        self.org_id = uuid.uuid4()
        db.execute("INSERT INTO orgs (id, name) VALUES (%s, %s)", (self.org_id, f"{name} {self.org_id.hex[:6]}"))
        self.nurse_id = self._user("nurse", "Nora Nurse")
        self.nurse = client_for(self.nurse_id)

    def _user(self, role: str, name: str) -> uuid.UUID:
        return auth.create_user(org_id=self.org_id, role=role, name=name, title=f"{role} title",
                                email=f"{uuid.uuid4().hex[:12]}@agency.test", password="long-enough")

    def caregiver(self, name: str = "Casey Caregiver") -> tuple[uuid.UUID, TestClient]:
        user_id = self._user("caregiver", name)
        return user_id, client_for(user_id)

    def skill(self, name: str = "Practice skill", slug: str | None = None) -> dict:
        """A new skill version (a second call with the same slug makes version 2)."""
        slug = slug or f"skill_{uuid.uuid4().hex[:8]}"
        step = RubricStep(step_id="s1", order=1, title="Do it", description="", start_s=0, end_s=5, critical=False,
                          order_dependent=False, evals=StepEval(pass_criteria=["x"], fail_criteria=["y"],
                                                                unverified_when=[]))
        classification = Classification(skill_slug=slug, skill_name=name, category="transfer", confidence=1,
                                        summary="A skill for tests.", people=[], order_matters=False)
        skill_id = repo.create_skill(classification, Rubric(steps=[step], order_matters=False), None,
                                     slug=slug, name=name, org_id=self.org_id)
        return {"id": skill_id, "slug": slug, "name": name}

    def attempt(self, caregiver_id, skill: dict, score: float | None = 90.0, *, status: str = "passed",
                skill_match: bool = True, job: str = "done", sent: bool = False, flags: int = 0) -> uuid.UUID:
        """A graded attempt by a caregiver (or by a nurse, caregiver_id None). job 'running' leaves it
        processing and 'error' failed; sent marks it submitted as if the caregiver had sent it."""
        video = repo.create_video("attempt", repo.NO_FILE, "", {"duration_s": 30}, org_id=self.org_id,
                                  uploaded_by=caregiver_id)
        attempt_id = repo.create_attempt(skill["id"], video["id"], "Someone", caregiver_id=caregiver_id)
        job_id = repo.create_job("attempt", video["id"], skill_id=skill["id"], attempt_id=attempt_id)
        repo.update_job(job_id, status=job)
        if job == "done":
            db.execute("UPDATE attempts SET status=%s, score_pct=%s, skill_match=%s WHERE id=%s",
                       (status, score, skill_match, attempt_id))
        for i in range(flags):
            db.execute(
                """INSERT INTO safety_flags (id, video_id, attempt_id, kind, severity, start_s, description, source,
                                             counts_toward_score)
                   VALUES (%s,%s,%s,'patient_unsteady','high',%s,'Patient lost balance','gemini',true)""",
                (uuid.uuid4(), video["id"], attempt_id, float(i)))
        if sent:
            db.execute("UPDATE attempts SET submitted_at=now(), submit_kind='standard' WHERE id=%s", (attempt_id,))
        return attempt_id


def upload(client: TestClient, skill_id, content: bytes = b"not really a video"):
    """POST an attempt. The checks on assignment and attempts left come before the file is read,
    so a refusal never looks at these bytes; an accepted upload of them fails as unreadable (422)."""
    return client.post("/api/videos", data={"kind": "attempt", "skill_id": str(skill_id)},
                       files={"file": ("attempt.mp4", content, "video/mp4")})
