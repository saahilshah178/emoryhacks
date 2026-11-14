"""Spend accounting, the per-job allowance, and resuming jobs after a server restart.
No Gemini calls: the client is replaced by a stub."""
import datetime as dt
import socket
import types
import uuid
from concurrent.futures import Future

import pytest

from app import config, db, gemini, jobs, repo
from app.stages import evaluate, timeline


# --- Gemini stub --------------------------------------------------------------------
class _FakeInteractions:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def create(self, **body):
        self.calls.append(body)
        text = self.replies.pop(0)
        usage = types.SimpleNamespace(total_input_tokens=1000, total_output_tokens=100, total_thought_tokens=0)
        return types.SimpleNamespace(status="completed", output_text=text, usage=usage)


def _use(monkeypatch, replies) -> _FakeInteractions:
    fake = _FakeInteractions(replies)
    monkeypatch.setattr(gemini, "client", lambda: types.SimpleNamespace(interactions=fake))
    return fake


def _log_cost(job_id, usd, key=None, purpose="test"):
    db.execute("INSERT INTO gemini_calls (id, job_id, purpose, model, cost_usd, key_id) VALUES (%s,%s,%s,'m',%s,%s)",
               (uuid.uuid4(), job_id, purpose, usd, key))


class _Answer(gemini.BaseModel):
    answer: str


# --- spend per API key -----------------------------------------------------------------
def test_budget_counts_only_the_current_keys_spend(migrated, monkeypatch):
    monkeypatch.setattr(config, "GEMINI_API_KEY", "key-for-the-spend-test")
    before_mine, before_all = gemini.spent_usd(), gemini.spent_all_usd()
    _log_cost(None, 2.0, key=None)              # logged before keys were fingerprinted: the old key
    _log_cost(None, 3.0, key="0badc0de")        # another key
    _log_cost(None, 0.25, key=gemini.key_id())  # this key
    assert gemini.spent_usd() == pytest.approx(before_mine + 0.25)
    assert gemini.spent_all_usd() == pytest.approx(before_all + 5.25)
    assert gemini.key_id() == gemini.key_id("key-for-the-spend-test") and len(gemini.key_id()) == 8
    assert "key-for-the-spend-test" not in gemini.key_id()


def test_logged_calls_carry_the_key_fingerprint(migrated, monkeypatch):
    _use(monkeypatch, ['{"answer": "yes"}'])
    gemini.generate_json("key_probe", [gemini.text_part("hi")], _Answer)
    row = db.fetch_one("SELECT key_id FROM gemini_calls WHERE purpose='key_probe' ORDER BY created_at DESC LIMIT 1")
    assert row["key_id"] == gemini.key_id()


def test_health_reports_this_keys_spend(migrated):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        g = client.get("/api/health").json()["gemini"]
    assert g["budget_usd"] == config.GEMINI_BUDGET_USD and "spent_all_keys_usd" in g
    assert g["spent_usd"] <= g["spent_all_keys_usd"] + 1e-9


# --- the per-job ceiling, replay and repair ---------------------------------------------
def test_a_job_over_its_ceiling_sends_nothing(migrated, monkeypatch):
    fake = _use(monkeypatch, ['{"answer": "never"}'])
    job_id = uuid.uuid4()
    _log_cost(job_id, 0.31, key=gemini.key_id())
    with pytest.raises(gemini.JobBudgetExceeded):
        gemini.generate_json("capped", [gemini.text_part("hi")], _Answer, job_id=job_id, job_cap_usd=0.30)
    assert fake.calls == []
    assert jobs.failure_text(gemini.JobBudgetExceeded("x")).split("\n")[0] == jobs.JOB_OVER_CEILING


def test_a_request_the_job_already_paid_for_is_answered_from_the_log(migrated, monkeypatch):
    fake = _use(monkeypatch, ['{"answer": "first"}', '{"answer": "second"}'])
    job_id = uuid.uuid4()
    parts = [gemini.video_part("files/old", fps=2.0), gemini.text_part("grade it")]
    first = gemini.generate_json("assess", parts, _Answer, job_id=job_id)
    moved = gemini.with_uri(parts, "files/old", "files/new")  # uploaded again after a restart
    again = gemini.generate_json("assess", moved, _Answer, job_id=job_id)
    assert first.answer == again.answer == "first" and len(fake.calls) == 1
    other = gemini.generate_json("assess", [parts[0], gemini.text_part("something else")], _Answer, job_id=job_id)
    assert other.answer == "second" and len(fake.calls) == 2


def test_a_reply_that_does_not_validate_is_repaired_from_its_text(migrated, monkeypatch):
    fake = _use(monkeypatch, ['{"wrong": 1}', '{"answer": "fixed"}'])
    parts = [gemini.video_part("files/x"), gemini.text_part("grade it")]
    assert gemini.generate_json("repair_probe", parts, _Answer).answer == "fixed"
    fix = fake.calls[1]["input"]
    assert [p["type"] for p in fix] == ["text"] and '{"wrong": 1}' in fix[0]["text"]  # no video sent again


# --- the allowance on a StageContext ------------------------------------------------------
def _ctx(job_id=None, budget=0.15):
    video = {"id": uuid.uuid4(), "duration_s": 60.0, "gemini_file_uri": "files/a", "path": "/none"}
    return jobs.StageContext(job_id=job_id, video=video, attempt={"id": 1}, budget_usd=budget)


def test_optional_calls_are_skipped_once_the_allowance_is_spent(migrated, monkeypatch):
    sent = []
    monkeypatch.setattr(gemini, "generate_json", lambda purpose, parts, schema, **kw: sent.append(kw) or "ok")
    job_id = uuid.uuid4()
    ctx = _ctx(job_id)
    parts = [gemini.video_part("files/a", start_s=0, end_s=10, fps=2), gemini.text_part("look")]
    assert ctx.generate_json("second_look", parts, _Answer, optional=True) == "ok"
    assert sent[0]["job_cap_usd"] == pytest.approx(0.15 * config.GEMINI_JOB_HARD_LIMIT_FACTOR)
    _log_cost(job_id, 0.149, key=gemini.key_id())
    with pytest.raises(gemini.SkippedForBudget):
        ctx.generate_json("second_look", parts, _Answer, optional=True)
    assert ctx.generate_json("required", parts, _Answer) == "ok"  # required calls still go out
    assert jobs.StageContext(job_id=None, video=ctx.video).budget_usd is None  # scripts have no allowance
    assert jobs.StageContext(job_id=job_id, video=ctx.video).budget_usd == config.GEMINI_REFERENCE_BUDGET_USD


def test_an_expired_upload_is_uploaded_again_and_the_call_repeated(migrated, monkeypatch):
    seen = []

    def generate(purpose, parts, schema, **kw):
        seen.append(parts[0]["uri"])
        if parts[0]["uri"] == "files/a":
            raise gemini.FileUnavailable("File files/a does not exist")
        return "ok"

    def upload(video, force=False, verify=False):
        assert force
        video["gemini_file_uri"] = "files/b"
        return "files/b", "video/mp4"

    monkeypatch.setattr(gemini, "generate_json", generate)
    monkeypatch.setattr(gemini, "ensure_file", upload)
    ctx = _ctx()
    assert ctx.generate_json("assess", [gemini.video_part("files/a"), gemini.text_part("x")], _Answer) == "ok"
    assert seen == ["files/a", "files/b"]


def test_a_cached_upload_from_another_key_is_not_reused(migrated, monkeypatch):
    video = repo.create_video("reference", "/tmp/none.mp4", "x", {"duration_s": 5})
    future = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=30)
    db.execute("UPDATE videos SET gemini_file_name='files/old', gemini_file_uri='u-old', gemini_file_expires=%s, "
               "gemini_file_key='0badc0de' WHERE id=%s", (future, video["id"]))
    uploads = []

    class Files:
        def upload(self, file, config):
            uploads.append(file)
            return types.SimpleNamespace(name="files/new", uri="u-new", state=types.SimpleNamespace(name="ACTIVE"),
                                         expiration_time=future, mime_type="video/mp4")

    monkeypatch.setattr(gemini, "client", lambda: types.SimpleNamespace(files=Files()))
    assert gemini.ensure_file(repo.get_video(video["id"]))[0] == "u-new" and len(uploads) == 1
    assert gemini.ensure_file(repo.get_video(video["id"]))[0] == "u-new" and len(uploads) == 1  # now cached



class _ApiError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def test_an_error_about_the_uploaded_file_is_told_apart_from_a_missing_model():
    video = [gemini.video_part("files/old"), gemini.text_part("x")]
    gone = _ApiError(403, "You do not have permission to access the File files/old or it may not exist.")
    assert gemini._is_file_gone(gone, video)
    assert not gemini._is_file_gone(gone, [gemini.text_part("x")])  # no video in the request
    assert not gemini._is_file_gone(_ApiError(404, "models/gemini-x is not found for API version v1"), video)
    assert not gemini._is_file_gone(_ApiError(400, "API key not valid. Please pass a valid API key."), video)


# --- resuming after a restart ----------------------------------------------------------------
class _Killed(BaseException):
    """Stands in for the process being stopped: not an Exception, so nothing marks the job."""


def _run_now(fn, *args) -> Future:
    future = Future()
    fn(*args)
    future.set_result(None)
    return future


def _make_attempt(sample_video):
    ref = jobs.ingest(str(sample_video), "reference", sample_video.name)
    ref_job = repo.create_job("reference", ref["id"])
    jobs.run_reference(ref_job, slug="resume_demo", name="Resume demo")
    skill_id = repo.get_job(ref_job)["skill_id"]
    video = jobs.ingest(str(sample_video), "attempt", sample_video.name)
    attempt_id = repo.create_attempt(skill_id, video["id"], "Resumed")
    return attempt_id, repo.create_job("attempt", video["id"], skill_id=skill_id, attempt_id=attempt_id)


def _as_if_dead(job_id):
    db.execute("UPDATE jobs SET runner=%s WHERE id=%s", (f"{socket.gethostname()}:999999999", job_id))


def test_an_interrupted_attempt_resumes_after_its_finished_stages(migrated, sample_video, monkeypatch):
    attempt_id, job_id = _make_attempt(sample_video)

    def stopped(future):
        raise _Killed()
    monkeypatch.setattr(jobs, "_join_pose", stopped)
    with pytest.raises(_Killed):
        jobs.run_attempt(job_id)  # the server stops while waiting for pose
    job = repo.get_job(job_id)
    assert job["status"] == "running" and [s["status"] for s in job["stages"][:3]] == ["done", "done", "done"]
    monkeypatch.undo()

    # The finished stages must be loaded, not run (or paid for) again.
    monkeypatch.setattr(timeline, "run", lambda *a: pytest.fail("timeline ran again"))
    monkeypatch.setattr(evaluate, "run", lambda *a: pytest.fail("evaluate ran again"))
    _as_if_dead(job_id)
    resumed = jobs.resume_interrupted(submit=_run_now)
    assert [j for j, _ in resumed] == [job_id]
    job = repo.get_job(job_id)
    assert job["status"] == "done", job["error"]
    assert job["resumes"] == 1 and job["runner"] == repo._runner()
    attempt = repo.get_attempt(attempt_id)
    assert [s["status"] for s in attempt["steps"]] == ["passed", "failed", "unverified", "not_applicable"]
    assert attempt["status"] == "failed" and len(attempt["order_violations"]) == 1
    assert {f["source"] for f in attempt["safety_flags"]} == {"gemini", "pose"}


def test_loaders_return_what_was_saved(migrated, sample_video):
    attempt_id, job_id = _make_attempt(sample_video)
    jobs.run_attempt(job_id)
    from app.stages import _fake

    attempt = repo.get_attempt(attempt_id)
    rb = repo.get_rubric(attempt["skill_id"])
    ctx = types.SimpleNamespace(duration=float(attempt["video"]["duration_s"]))
    tl = _fake.timeline(ctx, rb)
    assert repo.load_timeline(attempt_id) == tl
    ev = repo.load_evaluation(attempt_id)
    assert ev.model_dump(exclude={"steps"}) == _fake.evaluation(ctx, rb, tl).model_dump(exclude={"steps"})
    assert [(s.step_id, s.status, s.evidence_start_s) for s in ev.steps] == [
        (s.step_id, s.status, s.evidence_start_s) for s in _fake.evaluation(ctx, rb, tl).steps]


def test_a_job_resumed_too_often_is_failed_with_a_readable_reason(migrated, sample_video):
    _, job_id = _make_attempt(sample_video)
    db.execute("UPDATE jobs SET status='running', resumes=%s WHERE id=%s", (config.JOB_MAX_RESUMES, job_id))
    _as_if_dead(job_id)
    assert jobs.resume_interrupted(submit=_run_now) == []
    job = repo.get_job(job_id)
    assert job["status"] == "error"
    assert job["error"].split("\n")[0] == jobs.TOO_MANY_RESTARTS.format(n=config.JOB_MAX_RESUMES + 1)


def test_jobs_of_a_live_process_or_running_here_are_left_alone(migrated, sample_video):
    _, live = _make_attempt(sample_video)
    _, mine = _make_attempt(sample_video)
    db.execute("UPDATE jobs SET runner=%s WHERE id=%s", (f"{socket.gethostname()}:1", live))  # pid 1 always exists
    with jobs._Running(mine):  # this process is running it right now
        resumed = jobs.resume_interrupted(submit=_run_now)
    assert live not in [j for j, _ in resumed] and mine not in [j for j, _ in resumed]
    assert repo.get_job(live)["status"] == "queued" and repo.get_job(mine)["status"] == "queued"
    db.execute("UPDATE jobs SET status='done' WHERE id = ANY(%s)", ([live, mine],))


def test_a_job_from_before_a_reboot_is_dead_even_if_its_pid_is_alive(migrated, sample_video):
    _, job_id = _make_attempt(sample_video)
    db.execute("UPDATE jobs SET runner=%s WHERE id=%s", (f"{socket.gethostname()}:1:notthisboot", job_id))
    here, _ = repo.interrupted_jobs()
    assert job_id in [j["id"] for j in here]
    db.execute("UPDATE jobs SET status='done' WHERE id=%s", (job_id,))


def test_an_interrupted_reference_job_resumes_with_its_forced_name(migrated, sample_video, monkeypatch):
    ref = jobs.ingest(str(sample_video), "reference", sample_video.name)
    job_id = repo.create_job("reference", ref["id"])
    monkeypatch.setattr(jobs, "_join_pose", lambda future: (_ for _ in ()).throw(_Killed()))
    with pytest.raises(_Killed):
        jobs.run_reference(job_id, slug="resumed_reference", name="Resumed reference")
    skill_id = repo.get_job(job_id)["skill_id"]
    assert skill_id  # classify and rubric finished, so the skill exists
    monkeypatch.undo()
    _as_if_dead(job_id)
    jobs.resume_interrupted(submit=_run_now)
    job = repo.get_job(job_id)
    assert job["status"] == "done", job["error"]
    assert job["skill_id"] == skill_id  # the same skill, not a second copy
    assert repo.get_skill(skill_id)["slug"] == "resumed_reference"
