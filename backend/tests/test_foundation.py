import time

from fastapi.testclient import TestClient

from app import db, jobs, media, repo
from app.models import (
    Evaluation, OrderViolation, Rubric, RubricStep, SafetyFlag, StepEval, StepResult, Timeline, TimelineStep,
)
from app.stages import scoring


def test_schema_is_idempotent(migrated):
    db.migrate()
    row = db.fetch_one("SELECT count(*) AS n FROM timescaledb_information.hypertables WHERE hypertable_name='pose_frames'")
    assert row["n"] == 1
    assert db.fetch_one("SELECT count(*) AS n FROM timescaledb_information.continuous_aggregates WHERE view_name='pose_1s'")["n"] == 1


def test_probe_and_thumbnail(sample_video, tmp_path):
    info = media.probe(sample_video)
    assert 60 < info["duration_s"] < 65 and info["width"] == 480 and info["vcodec"] == "h264"
    out = media.thumbnail(sample_video, 10, tmp_path / "t.jpg")
    assert out.stat().st_size > 1000
    assert media.frame_jpeg(sample_video, 5)[:2] == b"\xff\xd8"


def test_fake_pipelines_end_to_end(migrated, sample_video):
    ref = jobs.ingest(str(sample_video), "reference", sample_video.name)
    job_id = repo.create_job("reference", ref["id"])
    jobs.run_reference(job_id, slug="sit_to_stand", name="Sit to stand")
    job = repo.get_job(job_id)
    assert job["status"] == "done", job["error"]
    skill = repo.get_skill(job["skill_id"])
    assert skill["slug"] == "sit_to_stand" and len(skill["steps"]) == 4
    assert skill["steps"][0]["evals"]["pass_criteria"]

    video = jobs.ingest(str(sample_video), "attempt", sample_video.name)
    attempt_id = repo.create_attempt(skill["id"], video["id"], "Tester")
    job2 = repo.create_job("attempt", video["id"], skill_id=skill["id"], attempt_id=attempt_id)
    jobs.run_attempt(job2)
    done = repo.get_job(job2)
    assert done["status"] == "done", done["error"]
    attempt = repo.get_attempt(attempt_id)
    assert attempt["status"] == "failed"  # canned data has a failed critical step and an order violation
    # the canned rubric's last step is only sometimes needed, and canned grading finds it not needed
    assert [s["status"] for s in attempt["steps"]] == ["passed", "failed", "unverified", "not_applicable"]
    assert all(s["start_s"] is not None for s in attempt["steps"][:3]) and attempt["steps"][3]["start_s"] is None
    assert len(attempt["order_violations"]) == 1
    assert {f["source"] for f in attempt["safety_flags"]} == {"gemini", "pose"}
    assert db.fetch_one("SELECT count(*) AS n FROM pose_frames WHERE video_id=%s", (video["id"],))["n"] > 100
    assert db.fetch_one("SELECT count(*) AS n FROM pose_1s WHERE video_id=%s", (video["id"],))["n"] > 10

    repo.review_attempt(attempt_id, "passed", "Looked fine in person", [{"step_id": "s2", "status": "passed", "note": "ok"}])
    reviewed = repo.get_attempt(attempt_id)
    assert reviewed["final_status"] == "passed" and reviewed["steps"][1]["nurse_status"] == "passed"


def test_api_upload_stream_and_results(migrated, sample_video):
    from app.main import app

    with TestClient(app) as client:
        assert client.get("/api/health").json()["ok"] is True
        # The API serves no pages of its own; the web app is the only UI.
        assert client.get("/index.html").status_code == 404
        assert client.get("/").json()["health"] == "/api/health"
        with sample_video.open("rb") as f:
            res = client.post("/api/videos", data={"kind": "reference", "expected_slug": "sit_to_stand"},
                              files={"file": (sample_video.name, f, "video/mp4")})
        assert res.status_code == 200, res.text
        body = res.json()
        job = _wait(client, body["job_id"])
        assert job["status"] == "done", job["error"]
        skill_id = job["skill_id"]
        assert len(client.get(f"/api/skills/{skill_id}").json()["steps"]) == 4

        ranged = client.get(f"/api/videos/{body['video_id']}/file", headers={"Range": "bytes=0-99"})
        assert ranged.status_code == 206 and len(ranged.content) == 100
        thumb = client.get(f"/api/videos/{body['video_id']}/thumb?t=3")
        assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/jpeg"

        patched = client.patch(f"/api/skills/{skill_id}/steps/s1", json={"title": "Explain first"})
        assert patched.json()["steps"][0]["title"] == "Explain first"

        with sample_video.open("rb") as f:
            res = client.post("/api/videos", data={"kind": "attempt", "skill_id": skill_id, "caregiver_name": "Sam"},
                              files={"file": (sample_video.name, f, "video/mp4")})
        assert res.status_code == 200, res.text
        attempt_id = res.json()["attempt_id"]
        assert _wait(client, res.json()["job_id"])["status"] == "done"
        attempt = client.get(f"/api/attempts/{attempt_id}").json()
        assert attempt["status"] in ("passed", "failed", "unverified") and len(attempt["steps"]) == 4
        reviewed = client.post(f"/api/attempts/{attempt_id}/review", json={"overall": "passed", "note": "ok"}).json()
        assert reviewed["final_status"] == "passed"
        series = client.get(f"/api/safety/videos/{attempt['video_id']}/series").json()
        assert len(series["rows"]) > 10
        assert any(r["video_id"] == attempt["video_id"] for r in client.get("/api/safety/overview").json())
        assert client.post("/api/videos", data={"kind": "attempt"}, files={"file": ("x.mp4", b"abc", "video/mp4")}).status_code == 400


def _wait(client, job_id, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.5)
    raise AssertionError("job did not finish")


def _rubric(n=4, critical=(1,)):
    ev = StepEval(pass_criteria=["x"], fail_criteria=["y"], unverified_when=["z"])
    return Rubric(steps=[RubricStep(step_id=f"s{i+1}", order=i+1, title=f"Step {i+1}", description="", start_s=i, end_s=i+1,
                                    critical=i in critical, order_dependent=True, must_follow=[], evals=ev) for i in range(n)])


def _evaluation(statuses, **kw):
    return Evaluation(people=[], steps=[StepResult(step_id=f"s{i+1}", status=s, confidence=0.9, feedback="")
                                        for i, s in enumerate(statuses)], **kw)


def _timeline(n=4, violations=()):
    return Timeline(steps=[TimelineStep(step_id=f"s{i+1}", found=True, start_s=i, end_s=i+1, performed_index=i+1)
                           for i in range(n)], order_violations=list(violations))


def test_scoring_rules():
    rb = _rubric()
    assert scoring.score(rb, _timeline(), _evaluation(["passed"] * 4), []).overall == "passed"
    assert scoring.score(rb, _timeline(), _evaluation(["passed", "failed", "passed", "passed"]), []).overall == "failed"
    assert scoring.score(rb, _timeline(), _evaluation(["passed", "unverified", "passed", "passed"]), []).overall == "unverified"
    assert scoring.score(rb, _timeline(), _evaluation(["failed", "passed", "passed", "passed"]), []).overall == "passed"
    violation = OrderViolation(step_id="s3", expected_after="s2", message="s3 before s2")
    unsure = _timeline(violations=[violation])  # timeline confidence 0: the violation only asks for review
    assert scoring.score(rb, unsure, _evaluation(["passed"] * 4), []).overall == "unverified"
    sure = unsure.model_copy(update={"steps": [t.model_copy(update={"confidence": 0.9}) for t in unsure.steps]})
    out_of_order = scoring.score(rb, sure, _evaluation(["passed"] * 4), [])
    assert out_of_order.overall == "failed" and out_of_order.score_pct < 100
    high = SafetyFlag(kind="patient_distress", severity="high", start_s=1, description="grimacing")
    assert scoring.score(rb, _timeline(), _evaluation(["passed"] * 4), [high]).overall == "failed"
    medium = high.model_copy(update={"severity": "medium"})
    assert scoring.score(rb, _timeline(), _evaluation(["passed"] * 4), [medium]).overall == "unverified"
    advisory = high.model_copy(update={"source": "pose", "counts_toward_score": False})
    assert scoring.score(rb, _timeline(), _evaluation(["passed"] * 4), [advisory]).overall == "passed"
    assert scoring.score(rb, _timeline(), _evaluation(["passed"] * 4, skill_match=False), []).overall == "failed"


def test_several_servers_can_apply_the_schema_at_once(migrated):
    """Servers that start together on one database take turns applying the schema, so none of
    them fails on a statement another is running."""
    from concurrent.futures import ThreadPoolExecutor

    from app import db

    with ThreadPoolExecutor(max_workers=4) as pool:
        for future in [pool.submit(db.migrate) for _ in range(4)]:
            future.result()
