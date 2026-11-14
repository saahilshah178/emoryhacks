"""The "AI account needs attention" notice only reports failures under the current API key."""
import uuid

from app import db, gemini, repo

OUT_OF_CREDIT = "ClientError: 429 RESOURCE_EXHAUSTED. Your prepayment credits are depleted."


def _job(status: str, error: str | None = None) -> uuid.UUID:
    video = repo.create_video("attempt", repo.NO_FILE, "", {"duration_s": 10})
    job_id = repo.create_job("attempt", video["id"])
    repo.update_job(job_id, status=status, error=error)
    return job_id


def _call(key_id: str | None, when: str = "now()") -> None:
    db.execute(f"INSERT INTO gemini_calls (id, purpose, model, key_id, created_at) VALUES (%s,'test','m',%s,{when})",
               (uuid.uuid4(), key_id))


def test_a_failure_from_before_the_current_key_is_not_reported(migrated, monkeypatch):
    monkeypatch.setattr(gemini, "key_id", lambda key=None: "newkey01")
    db.execute("DELETE FROM gemini_calls WHERE key_id='newkey01'")
    db.execute("UPDATE jobs SET updated_at = now() - interval '2 days' WHERE status='error'")  # other tests' failures

    _call(None, "now() - interval '1 hour'")  # a call logged before keys were recorded: the old key
    _job("error", OUT_OF_CREDIT)
    assert repo.ai_problem() is None  # the new key has not been used: this failure was the old key's

    _call("newkey01")                 # the new key's first call, after that failure
    assert repo.ai_problem() is None

    failed = _job("error", OUT_OF_CREDIT)  # and now a failure under the new key
    assert "run out of credit" in repo.ai_problem()

    _job("done")                      # something has succeeded since
    assert repo.ai_problem() is None
    db.execute("UPDATE jobs SET updated_at = now() - interval '2 days' WHERE id=%s", (failed,))
