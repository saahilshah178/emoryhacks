"""The nurse's movement pages only cover recordings a caregiver has sent."""
import datetime as dt

from app import db, repo
from fixtures_agency import Agency


def _with_pose(attempt_id) -> None:
    video = repo.get_video(db.fetch_one("SELECT video_id FROM attempts WHERE id=%s", (attempt_id,))["video_id"])
    rows = [{"person_idx": 0, "t_offset": i / 10, "trunk_tilt": 10.0, "balance_score": 0.8} for i in range(30)]
    tracks = [{"person_idx": 0, "role": "patient", "first_t": 0, "last_t": 3, "n_frames": 30, "mean_visibility": 0.9}]
    repo.replace_pose(video["id"], video["recorded_at"] or dt.datetime.now(dt.timezone.utc), rows, tracks)


def test_unsent_practice_is_left_out_of_the_movement_pages(migrated):
    agency = Agency()
    caregiver_id, caregiver = agency.caregiver()
    skill = agency.skill()
    practice = agency.attempt(caregiver_id, skill, 90.0)
    sent = agency.attempt(caregiver_id, skill, 92.0, sent=True)
    for attempt_id in (practice, sent):
        _with_pose(attempt_id)

    def seen() -> tuple[set, set]:
        overview = {str(r["attempt_id"]) for r in agency.nurse.get("/api/safety/overview").json()}
        trends = {str(a["attempt_id"]) for a in agency.nurse.get("/api/safety/trends").json()["attempts"]}
        return overview, trends

    assert seen() == ({str(sent)}, {str(sent)})
    assert caregiver.post(f"/api/attempts/{practice}/submit", json={}).status_code == 200
    assert seen() == ({str(practice), str(sent)}, {str(practice), str(sent)})
