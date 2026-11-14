"""Stage: pose. Per-frame joint angles and balance readings into Tiger Data.

extract(ctx) reads the video once with OpenCV, runs MediaPipe Pose Landmarker on
sampled frames, keeps person identities with a box tracker, and writes one pose_frames
row per tracked person per sampled frame (formulas in app/pose_math.py).
assign_roles(ctx, people) asks Gemini which track is the caregiver and which the
patient, using one still frame per call.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Literal

import cv2
import httpx
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions
from pydantic import BaseModel, Field

from .. import config, db, gemini, pose_math, repo
from ..models import PersonObs, PoseSummary, SafetyFlag
from . import _fake

MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/"
             "float16/latest/pose_landmarker_full.task")
NUM_POSES = 2
MAX_SIDE_PX = 640           # frames are shrunk to this longest side before detection
IN_FRAME_MARGIN = 0.02      # landmarks further outside the frame than this are never "seen"
MIN_TRACK_FRAMES = 3        # tracks shorter than this many frames...
MIN_TRACK_SECONDS = 1.0     # ...or this many seconds of samples are spurious detections and dropped
SMOOTHING = 0.5             # weight of the newest frame in the landmark moving average
MAX_SMOOTH_GAP_S = 0.5      # a longer gap restarts smoothing and sway for a track

# Advisory flag rules (roles are not known yet, so these apply to every track).
OFF_CENTER_OFFSET = 1.0     # |com_offset| above this: centre of mass outside the feet
FLAG_TILT_DEG = 50.0        # trunk tilt at or above this is extreme...
LYING_TILT_DEG = 75.0       # ...unless it is this flat, which is lying down, not unsteady
FLAG_MIN_SECONDS = 1.0
MAX_FLAGS = 5

_model_lock = threading.Lock()
_model_bytes: bytes | None = None


def _model() -> bytes:
    """The pose_landmarker_full model, downloaded into config.MODEL_DIR on first use."""
    global _model_bytes
    with _model_lock:
        if _model_bytes is None:
            path = config.MODEL_DIR / "pose_landmarker_full.task"
            if not path.exists():
                config.ensure_dirs()
                tmp = path.with_suffix(".part")
                with httpx.stream("GET", MODEL_URL, follow_redirects=True, timeout=120) as res:
                    res.raise_for_status()
                    with tmp.open("wb") as f:
                        for chunk in res.iter_bytes():
                            f.write(chunk)
                tmp.rename(path)
            _model_bytes = path.read_bytes()
    return _model_bytes


def _landmarker(mode, num_poses: int):
    return vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_buffer=_model()), running_mode=mode, num_poses=num_poses))


def _arrays(landmarks, world) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(xy, visibility, world) arrays for one detected person.

    The visibility used everywhere is the lower of MediaPipe's visibility and presence, and
    zero for a landmark outside the frame: on close-ups MediaPipe invents a whole body
    around a pair of hands and reports the invented joints as highly visible."""
    xy = np.array([[p.x, p.y] for p in landmarks], dtype=float)
    vis = np.array([min(p.visibility or 0.0, p.presence or 0.0) for p in landmarks], dtype=float)
    in_frame = np.all((xy >= -IN_FRAME_MARGIN) & (xy <= 1 + IN_FRAME_MARGIN), axis=1)
    w = np.array([[p.x, p.y, p.z] for p in world], dtype=float)
    return xy, np.where(in_frame, vis, 0.0), w


class _Detector:
    """MediaPipe in VIDEO mode, plus a second IMAGE-mode pass that looks for one more person
    with the people already found painted out. VIDEO mode tracks the first person it
    finds and rarely picks up a second one that is close by, so without the second pass
    a caregiver standing next to a patient is usually missed."""

    def __init__(self):
        self.video = _landmarker(vision.RunningMode.VIDEO, NUM_POSES)
        self.extra = _landmarker(vision.RunningMode.IMAGE, 1)
        self.last_ms = -1

    def close(self) -> None:
        self.video.close()
        self.extra.close()

    def detect(self, rgb: np.ndarray, t: float) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
        ts = max(int(round(t * 1000)), self.last_ms + 1)  # strictly increasing timestamps
        self.last_ms = ts
        result = self.video.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts)
        people = [_arrays(lm, w) for lm, w in zip(result.pose_landmarks, result.pose_world_landmarks)]
        if 0 < len(people) < NUM_POSES:
            masked = rgb.copy()
            h, w = rgb.shape[:2]
            for xy, vis, _ in people:
                x0, y0, x1, y1 = pose_math.bounding_box(xy, vis)
                px, py = 0.05 * (x1 - x0), 0.05 * (y1 - y0)
                masked[int(max(0, y0 - py) * h):int(min(1, y1 + py) * h),
                       int(max(0, x0 - px) * w):int(min(1, x1 + px) * w)] = 127
            more = self.extra.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=masked))
            for lm, wl in zip(more.pose_landmarks, more.pose_world_landmarks):
                xy, vis, _ = found = _arrays(lm, wl)
                # The masked pass also "finds" furniture: insist on a seen, upright-enough trunk.
                if pose_math.core_seen(vis) and pose_math.is_valid(xy, vis):
                    people.append(found)
        boxes = [pose_math.bounding_box(xy, vis) for xy, vis, _ in people]
        keep = pose_math.drop_duplicates(boxes, [float(vis.mean()) for _, vis, _ in people])
        return [people[i] for i in keep]


def sample_rate(duration: float, video_fps: float) -> float:
    """Frames per second to sample: POSE_FPS, fewer for long videos so at most about
    POSE_MAX_FRAMES are measured, and never more than the video has."""
    return min(config.POSE_FPS, config.POSE_MAX_FRAMES / max(duration, 1e-6), video_fps or config.POSE_FPS)


def extract(ctx) -> PoseSummary:
    """Sample the video, measure every tracked person, and store the rows in Tiger Data."""
    if config.FAKE_AI:
        return _fake.pose(ctx)
    started = time.time()
    cap = cv2.VideoCapture(ctx.path)
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV could not open {ctx.path}")
    video_fps = cap.get(cv2.CAP_PROP_FPS) or float(ctx.video.get("fps") or 30)
    duration = ctx.duration or (cap.get(cv2.CAP_PROP_FRAME_COUNT) / video_fps)
    rate = sample_rate(duration, video_fps)

    detector = _Detector()
    tracker = pose_math.BoxTracker()
    smooth: dict[int, dict] = {}  # track id -> {"xy", "world", "com", "t"}
    rows: list[dict] = []
    segment, sampled = 0, 0
    prev_hist, after_blank = None, False
    try:
        for t, frame in _sampled_frames(cap, video_fps, rate):
            sampled += 1
            if pose_math.is_blank(frame):
                after_blank = True
                continue
            hist = pose_math.colour_histogram(frame)
            if prev_hist is not None and (after_blank or pose_math.is_cut(prev_hist, hist)):
                segment += 1
                detector.close()
                detector = _Detector()
                tracker.reset()
                smooth.clear()
            prev_hist, after_blank = hist, False
            rows += _measure(detector, tracker, smooth, frame, t, segment)
    finally:
        cap.release()
        detector.close()

    rows, tracks = _keep_real_tracks(rows, rate)
    n = repo.replace_pose(ctx.video_id, ctx.video["recorded_at"], rows, tracks)
    elapsed = time.time() - started
    flags = candidate_flags(rows, rate)
    valid = sum(1 for r in rows if r["valid"])
    note = (f"{sampled} frames sampled at {rate:.1f}/s in {elapsed:.1f}s ({sampled / max(elapsed, 1e-6):.0f} frames/s); "
            f"{segment} camera cuts; {valid} of {len(rows)} person-frames valid.")
    ctx.log(note)
    return PoseSummary(frames_written=n, tracks=len(tracks), segments=segment + 1, sample_fps=round(rate, 3),
                       candidate_flags=flags[:MAX_FLAGS], note=note)


def _sampled_frames(cap, video_fps: float, rate: float):
    """Yield (t, frame) at about `rate` frames per second, reading the file sequentially:
    every frame is grabbed, only sampled ones are decoded, and t comes from the frame index."""
    stride, next_sample, index = video_fps / rate, 0.0, 0
    while cap.grab():
        if index + 1e-6 >= next_sample:
            next_sample += stride
            ok, frame = cap.retrieve()
            if ok:
                yield index / video_fps, _shrink(frame)
        index += 1


def _shrink(frame: np.ndarray) -> np.ndarray:
    h, w = frame.shape[:2]
    scale = MAX_SIDE_PX / max(h, w)
    return cv2.resize(frame, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else frame


def _measure(detector: _Detector, tracker: pose_math.BoxTracker, smooth: dict, frame: np.ndarray, t: float,
             segment: int) -> list[dict]:
    """Detect, track and measure the people in one sampled frame."""
    h, w = frame.shape[:2]
    aspect = w / h
    people = detector.detect(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), t)
    ids = tracker.update(t, [pose_math.bounding_box(xy, vis) for xy, vis, _ in people])
    out = []
    for track_id, (xy, vis, world) in zip(ids, people):
        state = smooth.get(track_id)
        if state and t - state["t"] <= MAX_SMOOTH_GAP_S:
            xy = SMOOTHING * xy + (1 - SMOOTHING) * state["xy"]
            world = SMOOTHING * world + (1 - SMOOTHING) * state["world"]
        else:
            state = None
        row = pose_math.frame_readings(xy, vis, world, aspect)
        com = None
        if row.get("com_x") is not None:
            com = (row["com_x"] * aspect, row["com_y"])
            torso = pose_math.torso_length(xy * np.array([aspect, 1.0]), vis)
            if state and state.get("com") is not None and torso:
                row["sway_velocity"] = pose_math.sway_velocity(state["com"], com, t - state["t"], torso)
        smooth[track_id] = {"xy": xy, "world": world, "com": com, "t": t}
        row.update(person_idx=track_id, t_offset=round(t, 3), segment_id=segment)
        out.append(row)
    return out


def _keep_real_tracks(rows: list[dict], sample_fps: float) -> tuple[list[dict], list[dict]]:
    """Drop tracks too short to be a real person and renumber the rest 0, 1, 2... in order
    of first appearance. Returns (rows, pose_tracks dicts)."""
    by_track: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        by_track[r["person_idx"]].append(r)
    min_frames = max(MIN_TRACK_FRAMES, MIN_TRACK_SECONDS * sample_fps)
    kept = sorted((k for k, v in by_track.items() if len(v) >= min_frames), key=lambda k: by_track[k][0]["t_offset"])
    renumber = {old: new for new, old in enumerate(kept)}
    out_rows, tracks = [], []
    for old in kept:
        track_rows = by_track[old]
        for r in track_rows:
            r["person_idx"] = renumber[old]
        out_rows += track_rows
        tracks.append({"person_idx": renumber[old], "segment_id": track_rows[0]["segment_id"],
                       "first_t": track_rows[0]["t_offset"], "last_t": track_rows[-1]["t_offset"],
                       "n_frames": len(track_rows), "role": "unknown",
                       "mean_visibility": float(np.mean([r["visibility"] for r in track_rows]))})
    out_rows.sort(key=lambda r: (r["t_offset"], r["person_idx"]))
    return out_rows, tracks


def candidate_flags(rows: list[dict], sample_fps: float, labels: dict[int, str] | None = None) -> list[SafetyFlag]:
    """Sustained windows (FLAG_MIN_SECONDS or longer) where a track's centre of mass is
    outside its base of support, or its trunk tilt is extreme without lying down.
    Strongest first. labels maps person_idx to a person_label (default "track N")."""
    max_gap = max(0.35, 1.5 / max(sample_fps, 1e-6))
    by_track: dict[int, list[dict]] = defaultdict(list)
    for r in sorted(rows, key=lambda r: r["t_offset"]):
        if r.get("valid"):
            by_track[r["person_idx"]].append(r)
    scored: list[tuple[float, SafetyFlag]] = []
    for idx, track in by_track.items():
        label = (labels or {}).get(idx, f"track {idx}")
        times = [r["t_offset"] for r in track]
        offsets = [abs(r["com_offset"]) if r.get("com_offset") is not None else None for r in track]
        off = [o is not None and o > OFF_CENTER_OFFSET for o in offsets]
        for w in pose_math.sustained_windows(times, off, FLAG_MIN_SECONDS, max_gap):
            dur, peak = times[w[-1]] - times[w[0]], max(offsets[i] for i in w)
            mean_excess = float(np.mean([offsets[i] for i in w])) - OFF_CENTER_OFFSET
            severity = "high" if dur >= 3 and peak >= 2 else "medium" if dur >= 2 or peak >= 1.5 else "low"
            scored.append((dur * (1 + mean_excess), SafetyFlag(
                kind="patient_off_center", severity=severity, start_s=times[w[0]], end_s=times[w[-1]],
                person_label=label, source="pose", counts_toward_score=False,
                description=(f"Pose readings: {label}'s centre of mass was outside the base of support for "
                             f"{dur:.1f}s (peak {peak:.1f} half-widths from the middle of the feet)."))))
        tilts = [r.get("trunk_tilt") for r in track]
        bent = [a is not None and FLAG_TILT_DEG <= a < LYING_TILT_DEG for a in tilts]
        for w in pose_math.sustained_windows(times, bent, FLAG_MIN_SECONDS, max_gap):
            dur, peak = times[w[-1]] - times[w[0]], max(tilts[i] for i in w)
            mean = float(np.mean([tilts[i] for i in w]))
            severity = "high" if dur >= 2 and peak >= 70 else "medium" if dur >= 2 or peak >= 60 else "low"
            scored.append((dur * (1 + (mean - FLAG_TILT_DEG) / 20), SafetyFlag(
                kind="patient_unsteady", severity=severity, start_s=times[w[0]], end_s=times[w[-1]],
                person_label=label, source="pose", counts_toward_score=False,
                description=(f"Pose readings: {label}'s trunk tilted {mean:.0f} degrees from vertical on average "
                             f"(peak {peak:.0f}) for {dur:.1f}s."))))
    scored.sort(key=lambda s: -s[0])
    return [f for _, f in scored]


# --- roles ----------------------------------------------------------------
MAX_ROLE_CALLS = 4
MIN_ROLE_FRAMES = 10   # tracks shorter than this are not worth a Gemini call
MIN_ROLE_IOU = 0.2


class RoleBox(BaseModel):
    label: str = Field(description="label from the list of people when one matches, else a new label")
    role: Literal["caregiver", "patient", "other"]
    box_2d: list[int] = Field(description="[ymin, xmin, ymax, xmax] on a 0-1000 scale around the whole person")


class RoleBoxes(BaseModel):
    people: list[RoleBox]


def assign_roles(ctx, people: list[PersonObs]) -> None:
    """Label pose tracks as caregiver, patient or other and store them with repo.set_track_roles.

    One person and no patient: every track is that caregiver, with no Gemini call.
    Otherwise up to MAX_ROLE_CALLS stills are sent to Gemini, each at a time when as many
    unlabelled tracks as possible are visible, and the returned boxes are matched to the
    track boxes by overlap. Tracks that cannot be matched stay 'unknown'."""
    tracks = [t for t in repo.get_tracks(ctx.video_id) if t["n_frames"] >= MIN_ROLE_FRAMES]
    if not tracks:
        return
    if len(people) <= 1 and not any(p.role == "patient" for p in people) and not _overlap_in_time(tracks):
        repo.set_track_roles(ctx.video_id, {t["person_idx"]: "caregiver" for t in tracks})
        return
    if config.FAKE_AI:
        return
    frames = db.fetch_all(
        """SELECT person_idx, t_offset, visibility, bbox_x0, bbox_y0, bbox_x1, bbox_y1 FROM pose_frames
           WHERE video_id=%s AND valid ORDER BY t_offset""", (ctx.video_id,))
    by_time: dict[float, dict[int, dict]] = defaultdict(dict)
    for f in frames:
        by_time[f["t_offset"]][f["person_idx"]] = f
    pending = {t["person_idx"]: t for t in tracks}
    roles: dict[int, str] = {}
    for _ in range(MAX_ROLE_CALLS):
        if not pending:
            break
        anchor = max(pending.values(), key=lambda t: t["n_frames"])
        t = _best_time(by_time, anchor, set(pending))
        if t is None:
            pending.pop(anchor["person_idx"])
            continue
        present = {k: v for k, v in by_time[t].items() if k in pending}
        try:
            found = _ask_roles(ctx, t, people)
        except gemini.GeminiError as exc:
            ctx.log(f"roles: Gemini call failed at {t:.1f}s: {exc}")
            break
        for idx, role in _match_roles(present, found).items():
            roles[idx] = role
            pending.pop(idx, None)
        pending.pop(anchor["person_idx"], None)  # never ask about the same track twice
    if roles:
        repo.set_track_roles(ctx.video_id, roles)


def _overlap_in_time(tracks: list[dict]) -> bool:
    spans = sorted((t["first_t"], t["last_t"]) for t in tracks)
    return any(b[0] < a[1] for a, b in zip(spans, spans[1:]))


def _best_time(by_time: dict[float, dict[int, dict]], anchor: dict, pending: set[int]) -> float | None:
    """A time when the anchor track is valid, preferring more pending tracks in view, then
    better visibility, then frames near the middle of the anchor track."""
    mid = (anchor["first_t"] + anchor["last_t"]) / 2
    best, best_key = None, None
    for t, present in by_time.items():
        if anchor["person_idx"] not in present:
            continue
        here = [p for k, p in present.items() if k in pending]
        key = (len(here), round(min(p["visibility"] for p in here), 1), -abs(t - mid))
        if best_key is None or key > best_key:
            best, best_key = t, key
    return best


def _ask_roles(ctx, t: float, people: list[PersonObs]) -> list[RoleBox]:
    listed = "\n".join(f"- {p.label} ({p.role}): {p.description}" for p in people) or "- (no description available)"
    prompt = (
        "This is one still frame from a caregiving video. Earlier analysis of the video described these people:\n"
        f"{listed}\n\n"
        "Return one entry for every person visible in this frame, including people only partly in view. "
        "For each give box_2d = [ymin, xmin, ymax, xmax] on a 0-1000 scale around the whole visible body, "
        "role = caregiver (the person giving help), patient (the person being helped) or other, "
        "and label = the matching label from the list above."
    )
    reply = ctx.generate_json("pose_roles", [gemini.image_part(ctx.frame_jpeg(t)), gemini.text_part(prompt)],
                              RoleBoxes, model="main", thinking="low")
    return [p for p in reply.people if len(p.box_2d) == 4]


def _match_roles(present: dict[int, dict], found: list[RoleBox]) -> dict[int, str]:
    """Match Gemini's boxes to track boxes by overlap; returns person_idx -> role."""
    ids = list(present)
    track_boxes = [(present[k]["bbox_x0"], present[k]["bbox_y0"], present[k]["bbox_x1"], present[k]["bbox_y1"])
                   for k in ids]
    gem_boxes = []
    for p in found:
        y0, x0, y1, x1 = (min(1000, max(0, v)) / 1000 for v in p.box_2d)
        gem_boxes.append((min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)))
    return {ids[i]: found[j].role for i, j in pose_math.match_boxes(track_boxes, gem_boxes, min_iou=MIN_ROLE_IOU,
                                                                     max_centre_dist=0.0)}
