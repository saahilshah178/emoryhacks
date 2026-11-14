"""Pose maths, tracking, cut detection, flags, roles and the safety API. No Gemini calls."""
import shutil

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config, db, jobs, media, pose_math as pm, repo
from app.models import PersonObs
from app.stages import pose
from app.stages.pose import RoleBox, RoleBoxes


# --- synthetic bodies ------------------------------------------------------
def standing_body(shift_x: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """A symmetric person standing upright, facing the camera, centred at x=0.5+shift_x."""
    xy = np.full((33, 2), 0.5)
    points = {
        pm.NOSE: (0.5, 0.21), pm.L_EAR: (0.48, 0.2), pm.R_EAR: (0.52, 0.2),
        pm.L_SHOULDER: (0.45, 0.3), pm.R_SHOULDER: (0.55, 0.3),
        pm.L_ELBOW: (0.45, 0.45), pm.R_ELBOW: (0.55, 0.45),
        pm.L_WRIST: (0.45, 0.6), pm.R_WRIST: (0.55, 0.6),
        pm.L_INDEX: (0.45, 0.64), pm.R_INDEX: (0.55, 0.64),
        pm.L_HIP: (0.45, 0.6), pm.R_HIP: (0.55, 0.6),
        pm.L_KNEE: (0.45, 0.75), pm.R_KNEE: (0.55, 0.75),
        pm.L_ANKLE: (0.45, 0.9), pm.R_ANKLE: (0.55, 0.9),
        pm.L_HEEL: (0.45, 0.92), pm.R_HEEL: (0.55, 0.92),
        pm.L_TOE: (0.44, 0.94), pm.R_TOE: (0.56, 0.94),
    }
    for i, p in points.items():
        xy[i] = p
    xy[:, 0] += shift_x
    return xy, np.ones(33)


def test_joint_angles():
    assert pm.joint_angle((0, 0), (0, 1), (0, 2)) == pytest.approx(180)
    assert pm.joint_angle((1, 0), (0, 0), (0, 1)) == pytest.approx(90)
    assert pm.joint_angle((1, 0, 0), (0, 0, 0), (0, 0, 1)) == pytest.approx(90)
    assert pm.joint_angle((0, 0), (0, 0), (1, 1)) is None
    assert pm.angle_from_vertical((0, 1), (0, 0)) == pytest.approx(0)       # upper point straight above
    assert pm.angle_from_vertical((0, 0), (1, 0)) == pytest.approx(90)
    assert pm.angle_from_vertical((0, 0, 0), (0, -1, -1)) == pytest.approx(45)  # leaning towards the camera
    assert pm.lateral_lean((0, 1), (1, 0)) == pytest.approx(45)
    assert pm.lateral_lean((0, 1), (-1, 0)) == pytest.approx(-45)


def test_upright_centred_body():
    xy, vis = standing_body()
    row = pm.frame_readings(xy, vis, None, aspect=1.0)
    assert row["valid"] is True
    assert row["trunk_tilt"] == pytest.approx(0, abs=1e-6)
    assert row["trunk_lateral"] == pytest.approx(0, abs=1e-6)
    assert row["l_knee"] == pytest.approx(180) and row["r_hip"] == pytest.approx(180)
    assert row["l_elbow"] == pytest.approx(180)
    assert row["com_x"] == pytest.approx(0.5)
    assert row["com_offset"] == pytest.approx(0, abs=1e-9)
    assert row["balance_score"] == pytest.approx(1)


def test_com_off_the_feet_and_missing_feet():
    xy, vis = standing_body()
    xy[: pm.L_HIP, 0] += 0.3  # upper body shifted sideways over a planted lower body
    row = pm.frame_readings(xy, vis, None, aspect=1.0)
    assert row["com_offset"] > 1 and row["balance_score"] == 0
    assert row["trunk_lateral"] > 0
    vis[[pm.R_ANKLE, pm.R_HEEL, pm.R_TOE]] = 0  # one foot unseen: readings left out, not guessed
    row = pm.frame_readings(xy, vis, None, aspect=1.0)
    assert row["valid"] and row["l_knee"] is not None and row["r_knee"] is None
    assert row.get("com_x") is None and row.get("com_offset") is None and row.get("balance_score") is None


def test_seated_person_has_no_balance_reading():
    xy, vis = standing_body()
    xy[pm.L_KNEE] = (0.30, 0.6)  # thighs horizontal
    xy[pm.R_KNEE] = (0.36, 0.6)
    row = pm.frame_readings(xy, vis, None, aspect=1.0)
    assert row["l_hip"] == pytest.approx(90)
    assert row.get("balance_score") is None


def test_hands_only_frame_is_invalid():
    xy, vis = standing_body()
    vis[:] = 0
    vis[[pm.L_WRIST, pm.R_WRIST, 17, 18, 19, 20, 21, 22]] = 0.9  # 8 finger and wrist points
    row = pm.frame_readings(xy, vis, None, aspect=1.0)
    assert row["valid"] is False and "l_knee" not in row and row["bbox_x0"] >= 0


def test_sway_velocity_in_torso_lengths():
    assert pm.sway_velocity((0, 0), (0.3, 0.4), dt=0.5, torso=0.5) == pytest.approx(2.0)
    assert pm.sway_velocity((0, 0), (1, 1), dt=0, torso=0.5) is None


def test_tracker_keeps_ids_and_starts_new_ones():
    tracker = pm.BoxTracker(max_gap_s=1.0)
    a, b = (0.1, 0.1, 0.3, 0.9), (0.6, 0.1, 0.8, 0.9)
    assert tracker.update(0.0, [a, b]) == [0, 1]
    moved = [(0.62, 0.1, 0.82, 0.9), (0.12, 0.1, 0.32, 0.9)]  # listed in the other order
    assert tracker.update(0.1, moved) == [1, 0]
    assert tracker.update(0.2, [(0.12, 0.1, 0.32, 0.9)]) == [0]
    assert tracker.update(2.0, [(0.12, 0.1, 0.32, 0.9)]) == [2]  # unseen for too long: new track
    tracker.reset()
    assert tracker.update(2.1, [(0.12, 0.1, 0.32, 0.9)]) == [3]  # after a cut ids keep counting
    assert pm.match_boxes([(0, 0, 0.1, 0.1)], [(0.8, 0.8, 0.9, 0.9)]) == []


def test_drop_duplicates():
    boxes = [(0.1, 0.1, 0.5, 0.9), (0.12, 0.1, 0.5, 0.9), (0.6, 0.1, 0.9, 0.9)]
    assert pm.drop_duplicates(boxes, [0.5, 0.9, 0.7]) == [1, 2]


def test_cut_detection_on_synthetic_frames():
    rng = np.random.default_rng(0)
    room = np.zeros((90, 160, 3), np.uint8)
    room[:, :80] = (40, 120, 200)
    room[:, 80:] = (200, 200, 180)
    noisy = np.clip(room.astype(int) + rng.integers(-6, 7, room.shape), 0, 255).astype(np.uint8)
    other_shot = np.zeros_like(room)
    other_shot[:] = (30, 160, 40)
    assert not pm.is_cut(pm.colour_histogram(room), pm.colour_histogram(noisy))
    assert pm.is_cut(pm.colour_histogram(room), pm.colour_histogram(other_shot))
    assert pm.is_blank(np.zeros_like(room)) and not pm.is_blank(room)


def test_sustained_windows():
    times = [i * 0.1 for i in range(40)]
    mask = [10 <= i < 25 and i != 17 for i in range(40)]  # 1.4 s with a one-frame break
    assert pm.sustained_windows(times, mask, 1.0, 0.35) == [[i for i in range(10, 25) if i != 17]]
    assert pm.sustained_windows(times, [i < 5 for i in range(40)], 1.0, 0.35) == []


def test_candidate_flags():
    rows = []
    for i in range(60):
        t = i * 0.1
        rows.append({"person_idx": 0, "t_offset": t, "valid": True, "com_offset": 1.6 if 10 <= i < 35 else 0.2,
                     "trunk_tilt": 10.0})
        rows.append({"person_idx": 1, "t_offset": t, "valid": True, "com_offset": None,
                     "trunk_tilt": 90.0 if i < 50 else 55.0})  # lying down, then 0.9 s bent: no flag
    flags = pose.candidate_flags(rows, 10.0)
    assert len(flags) == 1
    f = flags[0]
    assert f.kind == "patient_off_center" and f.source == "pose" and not f.counts_toward_score
    assert f.person_label == "track 0" and f.start_s == pytest.approx(1.0) and f.end_s == pytest.approx(3.4)
    assert "2.4s" in f.description


# --- database-backed ----------------------------------------------------------
@pytest.fixture()
def fake_video(migrated, sample_video):
    video = jobs.ingest(str(sample_video), "attempt", sample_video.name)
    return video


def _tracks(video_id, spans):
    rows, tracks = [], []
    for idx, (first, last, x0) in enumerate(spans):
        for k in range(int((last - first) * 10) + 1):
            rows.append({"person_idx": idx, "t_offset": first + k / 10, "valid": True, "visibility": 0.9,
                         "bbox_x0": x0, "bbox_y0": 0.1, "bbox_x1": x0 + 0.3, "bbox_y1": 0.9, "trunk_tilt": 10})
        tracks.append({"person_idx": idx, "segment_id": 0, "first_t": first, "last_t": last,
                       "n_frames": int((last - first) * 10) + 1, "mean_visibility": 0.9})
    return rows, tracks


def test_assign_roles_single_caregiver_without_gemini(fake_video):
    video = fake_video
    rows, tracks = _tracks(video["id"], [(0, 5, 0.1), (6, 9, 0.2)])
    repo.replace_pose(video["id"], video["recorded_at"], rows, tracks)
    ctx = jobs.StageContext(job_id=None, video=video)
    pose.assign_roles(ctx, [PersonObs(label="P1", role="caregiver", description="nurse")])
    assert {t["role"] for t in repo.get_tracks(video["id"])} == {"caregiver"}


class StubCtx(jobs.StageContext):
    """A StageContext whose Gemini call and frame grab are canned."""

    calls: list

    def frame_jpeg(self, t, width=960):
        return b"\xff\xd8fake"

    def generate_json(self, purpose, parts, schema, **kwargs):
        self.calls.append((purpose, parts[0]["type"], schema))
        return RoleBoxes(people=[  # [ymin, xmin, ymax, xmax] on 0-1000
            RoleBox(label="P2", role="patient", box_2d=[100, 600, 900, 900]),
            RoleBox(label="P1", role="caregiver", box_2d=[100, 100, 900, 400]),
        ])


def test_assign_roles_matches_gemini_boxes(fake_video, monkeypatch):
    video = fake_video
    rows, tracks = _tracks(video["id"], [(0, 5, 0.1), (0, 5, 0.6)])
    repo.replace_pose(video["id"], video["recorded_at"], rows, tracks)
    monkeypatch.setattr(config, "FAKE_AI", False)
    ctx = StubCtx(job_id=None, video=video)
    ctx.calls = []
    pose.assign_roles(ctx, [PersonObs(label="P1", role="caregiver", description="scrubs"),
                            PersonObs(label="P2", role="patient", description="seated")])
    roles = {t["person_idx"]: t["role"] for t in repo.get_tracks(video["id"])}
    assert roles == {0: "caregiver", 1: "patient"}
    assert len(ctx.calls) == 1 and ctx.calls[0][1] == "image"


def test_extract_real_mediapipe_on_a_short_clip(migrated, tmp_path, monkeypatch):
    """Runs MediaPipe for real (no Gemini) on 4 s of a two-person clip, using the model
    already downloaded into the worktree's data/models, if any."""
    model = config.ROOT / "data" / "models" / "pose_landmarker_full.task"
    if not model.exists():
        pytest.skip("pose model not downloaded (run scripts.try_pose once)")
    config.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy(model, config.MODEL_DIR / model.name)
    clip = tmp_path / "clip.mp4"
    media.cut(config.REFERENCE_DIR / "Fall Response Backup.mp4", clip, [(20, 24)])
    video = jobs.ingest(str(clip), "attempt", "clip.mp4")
    monkeypatch.setattr(config, "FAKE_AI", False)
    summary = pose.extract(jobs.StageContext(job_id=None, video=video))
    assert summary.sample_fps == pytest.approx(min(config.POSE_FPS, 29.97), abs=0.5)  # every frame of a short clip
    assert summary.tracks >= 1 and summary.frames_written >= 40
    stored = db.fetch_one("""SELECT count(*) AS n, count(*) FILTER (WHERE valid) AS valid,
                                    avg(trunk_tilt) AS tilt, count(l_knee) AS knees
                             FROM pose_frames WHERE video_id=%s""", (video["id"],))
    assert stored["n"] == summary.frames_written and stored["valid"] > 30 and stored["knees"] > 30
    assert 0 <= stored["tilt"] < 60


def test_safety_api(fake_video):
    from app.main import app

    video = fake_video
    pose.extract(jobs.StageContext(job_id=None, video=video))  # FAKE_AI: synthetic two-person series
    vid = str(video["id"])
    with TestClient(app) as client:
        overview = {r["video_id"]: r for r in client.get("/api/safety/overview").json()}
        row = overview[vid]
        assert row["tracks"] == 2 and row["tracks_with_role"] == 2
        assert 0 <= row["patient_balance_avg"] <= 1 and row["caregiver_tilt_peak"] >= row["caregiver_tilt_avg"]
        assert 0 <= row["patient_off_center_share"] <= 1

        fine = client.get(f"/api/safety/videos/{vid}/series?bucket_s=0.5").json()
        assert fine["source"] == "pose_frames" and {r["role"] for r in fine["rows"]} == {"caregiver", "patient"}
        coarse = client.get(f"/api/safety/videos/{vid}/series?bucket_s=5").json()
        assert coarse["source"] == "pose_1s" and all(r["t_offset"] >= 0 for r in coarse["rows"])
        assert len(coarse["rows"]) < len(fine["rows"])

        frames = client.get(f"/api/safety/videos/{vid}/frames?metrics=l_knee,balance_score&points=50").json()
        assert {(s["metric"], s["person_idx"]) for s in frames["series"]} == {
            ("l_knee", 0), ("l_knee", 1), ("balance_score", 0), ("balance_score", 1)}
        assert all(len(s["t"]) <= 52 for s in frames["series"])
        assert client.get(f"/api/safety/videos/{vid}/frames?metrics=nope").status_code == 400

        summary = client.get(f"/api/safety/videos/{vid}/summary").json()
        assert [t["role"] for t in summary["tracks"]] == ["caregiver", "patient"]
        assert summary["thresholds"]["tilt_bent"] == 60
        assert isinstance(summary["pose_windows"], list) and summary["segments"] == 1

        assert client.get("/api/safety/trends").status_code == 200
        storage = client.get("/api/safety/storage").json()
        assert storage["rows"]["pose_frames"] > 0 and storage["hypertable"]["hypertable_name"] == "pose_frames"
        assert storage["rollup"]["view_name"] == "pose_1s"
        assert client.get("/api/safety/videos/not-a-uuid/summary").status_code == 404
