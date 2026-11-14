"""Create one skill and one attempt from a short reference video using canned AI output.
Run with FIRSTSHIFT_FAKE_AI=1 (see `make fake-demo`). No Gemini calls are made."""
import sys

from app import config, db, jobs, repo

if __name__ == "__main__":
    if not config.FAKE_AI:
        sys.exit("Set FIRSTSHIFT_FAKE_AI=1 to run the fake demo.")
    db.migrate()
    src = config.REFERENCE_DIR / "sittostand_primary.mp4"
    ref = jobs.ingest(str(src), "reference", src.name)
    job_id = repo.create_job("reference", ref["id"])
    jobs.run_reference(job_id, slug="sit_to_stand", name="Sit to stand (fake)")
    job = repo.get_job(job_id)
    print("reference job:", job["status"], job["error"] or "")
    att_video = jobs.ingest(str(src), "attempt", src.name)
    attempt_id = repo.create_attempt(job["skill_id"], att_video["id"], "Demo caregiver")
    job2 = repo.create_job("attempt", att_video["id"], skill_id=job["skill_id"], attempt_id=attempt_id)
    jobs.run_attempt(job2)
    done = repo.get_job(job2)
    attempt = repo.get_attempt(attempt_id)
    print("attempt job:", done["status"], done["error"] or "")
    print(f"skill_id={job['skill_id']} attempt_id={attempt_id} result={attempt['status']} score={attempt['score_pct']}")
