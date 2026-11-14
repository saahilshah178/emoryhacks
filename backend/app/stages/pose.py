"""Stage: pose. Per-frame joint angles and balance readings into Tiger Data.

extract(ctx) reads the video once with OpenCV, runs MediaPipe Pose Landmarker on
sampled frames, keeps person identities with a box tracker, and writes one pose_frames
row per tracked person per sampled frame (formulas in app/pose_math.py).
assign_roles(ctx, people) asks Gemini which track is the caregiver and which the
patient, in one call with up to MAX_ROLE_FRAMES still frames (none when the people list
already settles it).
"""
from __future__ import annotations

import math
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

ROLES_TIMEOUT_S = 90   # the call that matches people in still frames to their roles

MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/"
             "float16/latest/pose_landmarker_full.task")
NUM_POSES = 2
MAX_SIDE_PX = 640           # frames are shrunk to this longest side before detection
IN_FRAME_MARGIN = 0.02      # landmarks further outside the frame than this are never "seen"
MIN_TRACK_FRAMES = 3        # tracks shorter than this many frames...
MIN_TRACK_SECONDS = 1.0     # ...or this many seconds of samples are spurious detections and dropped
# Landmarks are smoothed with an exponential moving average whose time constant does not
# depend on the sampling rate: the newest frame weighs 0.5 at 10 frames/s, about 0.2 at 30.
SMOOTHING_TAU_S = 0.1 / math.log(2)
MAX_SMOOTH_GAP_S = 0.5      # a longer gap restarts smoothing and sway for a track
# Balance readings are kept only inside runs of standing frames lasting this long, so a
# seated person who passes the standing test in a stray frame gets no reading.
MIN_STANDING_SECONDS = 0.5
MAX_STANDING_GAP_S = 0.25   # undetected time bridged inside a standing run
BALANCE_KEYS = ("bos_center_x", "bos_width", "com_offset", "balance_score", "sway_velocity")

# Advisory flag rules (roles are not known yet, so these apply to every track).
OFF_CENTER_OFFSET = 1.0     # |com_offset| above this: centre of mass outside the feet
FLAG_TILT_DEG = 50.0        # trunk tilt at or above this is extreme...
LYING_TILT_DEG = pose_math.LYING_TILT_DEG  # ...unless it is this flat, which is lying down, not unsteady
RISING_KNEE_DEG = 20.0      # a lean while the knees straighten this much is standing up, not unsteady
FLAG_MIN_SECONDS = 1.0
MAX_FLAGS = 5               # pose flags kept per video, after relabel_flags

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
    keep_standing_balance(rows)
    n = repo.replace_pose(ctx.video_id, ctx.video["recorded_at"], rows, tracks)
    elapsed = time.time() - started
    flags = candidate_flags(rows, rate)
    valid = sum(1 for r in rows if r["valid"])
    coverage = "every frame" if rate >= 0.99 * video_fps else f"{rate:.1f} of {video_fps:.0f} frames/s"
    note = (f"{sampled} frames measured ({coverage}) in {elapsed:.1f}s ({sampled / max(elapsed, 1e-6):.0f} frames/s); "
            f"{segment} camera cuts; {valid} of {len(rows)} person-frames valid.")
    ctx.log(note)
    # Every candidate is returned: which ones matter depends on roles, so relabel_flags keeps the top MAX_FLAGS.
    return PoseSummary(frames_written=n, tracks=len(tracks), segments=segment + 1, sample_fps=round(rate, 3),
                       candidate_flags=flags, note=note)


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


def smoothing_weight(dt: float) -> float:
    """Weight of the newest frame in the landmark moving average, dt seconds after the last."""
    return 1 - math.exp(-dt / SMOOTHING_TAU_S)


def _measure(detector: _Detector, tracker: pose_math.BoxTracker, smooth: dict, frame: np.ndarray, t: float,
             segment: int) -> list[dict]:
    """Detect, track and measure the people in one sampled frame."""
    h, w = frame.shape[:2]
    aspect = w / h
    scale = np.array([aspect, 1.0])
    people = detector.detect(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), t)
    ids = tracker.update(t, [pose_math.bounding_box(xy, vis) for xy, vis, _ in people],
                         [(xy * scale, vis) for xy, vis, _ in people])
    out = []
    for track_id, (xy, vis, world) in zip(ids, people):
        state = smooth.get(track_id)
        if state and t - state["t"] <= MAX_SMOOTH_GAP_S:
            # Average only landmarks seen in both frames: an unseen one is a guess.
            weight = smoothing_weight(t - state["t"])
            both = ((vis > pose_math.VISIBLE) & (state["vis"] > pose_math.VISIBLE))[:, None]
            xy = np.where(both, weight * xy + (1 - weight) * state["xy"], xy)
            world = np.where(both, weight * world + (1 - weight) * state["world"], world)
        else:
            state = None
        row = pose_math.frame_readings(xy, vis, world, aspect)
        com = None
        if row.get("com_x") is not None:
            com = (row["com_x"] * aspect, row["com_y"])
            torso = pose_math.torso_length(xy * scale, vis)
            if state and state.get("com") is not None and torso:
                row["sway_velocity"] = pose_math.sway_velocity(state["com"], com, t - state["t"], torso)
        smooth[track_id] = {"xy": xy, "world": world, "vis": vis, "com": com, "t": t}
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


def keep_standing_balance(rows: list[dict]) -> None:
    """Clear the balance readings (BALANCE_KEYS) of every row outside a run of standing
    frames lasting MIN_STANDING_SECONDS, per track, and the sway of each run's first row
    (it was measured from a frame that was not standing). Rows are changed in place."""
    by_track: dict[int, list[dict]] = defaultdict(list)
    for r in sorted(rows, key=lambda r: r["t_offset"]):
        by_track[r["person_idx"]].append(r)
    for track in by_track.values():
        times = [r["t_offset"] for r in track]
        mask = [bool(r.get("valid") and r.get("standing") and r.get("com_offset") is not None) for r in track]
        keep: set[int] = set()
        for run in pose_math.stable_runs(times, mask, MIN_STANDING_SECONDS, MAX_STANDING_GAP_S):
            keep.update(run)
            track[run[0]]["sway_velocity"] = None
        for i, r in enumerate(track):
            if i not in keep:
                for key in BALANCE_KEYS:
                    r[key] = None


UNNAMED = "a person"  # how a flag's description names someone whose role is not known


def _bent_knee(rows: list[dict]) -> float | None:
    """Mean over rows of the more bent knee's angle."""
    knees = [min(k for k in (r.get("l_knee"), r.get("r_knee")) if k is not None)
             for r in rows if r.get("l_knee") is not None or r.get("r_knee") is not None]
    return float(np.mean(knees)) if knees else None


def _is_rising(window: list[dict]) -> bool:
    """True when the more bent knee straightens by RISING_KNEE_DEG or more across a window:
    the person is standing up, and a forward lean then is the taught technique ("nose over toes")."""
    edge = max(1, len(window) // 5)
    first, last = _bent_knee(window[:edge]), _bent_knee(window[-edge:])
    return first is not None and last is not None and last - first >= RISING_KNEE_DEG


def candidate_flags(rows: list[dict], sample_fps: float) -> list[SafetyFlag]:
    """Sustained windows (FLAG_MIN_SECONDS or longer) where a track's centre of mass is
    outside its base of support, or its trunk tilt is extreme without lying down or standing
    up. Strongest first.

    Roles are not known yet, so each flag names its track in person_label as "track N" and
    calls the person "a person" in its description. "track N" is an internal key, not text
    for a nurse: relabel_flags must rewrite these flags before they are stored."""
    max_gap = max(0.35, 1.5 / max(sample_fps, 1e-6))
    by_track: dict[int, list[dict]] = defaultdict(list)
    for r in sorted(rows, key=lambda r: r["t_offset"]):
        if r.get("valid"):
            by_track[r["person_idx"]].append(r)
    scored: list[tuple[float, SafetyFlag]] = []
    for idx, track in by_track.items():
        key = f"track {idx}"
        times = [r["t_offset"] for r in track]
        offsets = [abs(r["com_offset"]) if r.get("com_offset") is not None else None for r in track]
        off = [o is not None and o > OFF_CENTER_OFFSET for o in offsets]
        for w in pose_math.sustained_windows(times, off, FLAG_MIN_SECONDS, max_gap):
            dur, peak = times[w[-1]] - times[w[0]], max(offsets[i] for i in w)
            mean_excess = float(np.mean([offsets[i] for i in w])) - OFF_CENTER_OFFSET
            severity = "high" if dur >= 3 and peak >= 2 else "medium" if dur >= 2 or peak >= 1.5 else "low"
            scored.append((dur * (1 + mean_excess), SafetyFlag(
                kind="patient_off_center", severity=severity, start_s=times[w[0]], end_s=times[w[-1]],
                person_label=key, source="pose", counts_toward_score=False,
                description=(f"Pose readings: {UNNAMED}'s weight was outside the area of their feet for {dur:.1f} s "
                             f"while standing (at worst {peak:.1f} times as far from the middle of the feet "
                             f"as the edge of the feet)."))))
        tilts = [r.get("trunk_tilt") for r in track]
        bent = [a is not None and FLAG_TILT_DEG <= a < LYING_TILT_DEG for a in tilts]
        for w in pose_math.sustained_windows(times, bent, FLAG_MIN_SECONDS, max_gap):
            if _is_rising([track[i] for i in w]):
                continue
            dur, peak = times[w[-1]] - times[w[0]], max(tilts[i] for i in w)
            mean = float(np.mean([tilts[i] for i in w]))
            severity = "high" if dur >= 2 and peak >= 70 else "medium" if dur >= 2 or peak >= 60 else "low"
            scored.append((dur * (1 + (mean - FLAG_TILT_DEG) / 20), SafetyFlag(
                kind="patient_unsteady", severity=severity, start_s=times[w[0]], end_s=times[w[-1]],
                person_label=key, source="pose", counts_toward_score=False,
                description=(f"Pose readings: {UNNAMED}'s upper body leaned {mean:.0f} degrees from upright on "
                             f"average (at most {peak:.0f}) for {dur:.1f} s."))))
    scored.sort(key=lambda s: -s[0])
    return [f for _, f in scored]


def _track_of(flag: SafetyFlag) -> int | None:
    """The person_idx in a candidate flag's internal "track N" label, else None."""
    parts = (flag.person_label or "").split()
    return int(parts[1]) if len(parts) == 2 and parts[0] == "track" and parts[1].isdigit() else None


def _renamed(flag: SafetyFlag, idx: int, subject: str, **update) -> SafetyFlag:
    """flag with its description's subject ("a person's" or "track N's") replaced by subject."""
    text = flag.description.replace(f"{UNNAMED}'s", f"{subject}'s", 1).replace(f"track {idx}'s", f"{subject}'s")
    return flag.model_copy(update={**update, "description": text})


def relabel_flags(video_id, flags: list[SafetyFlag]) -> list[SafetyFlag]:
    """Rewrite candidate flags once assign_roles has labelled the tracks, and keep the
    MAX_FLAGS most useful ones.

    Candidates are created before roles are known, with a patient kind and an internal
    "track N" label (candidate_flags). Each is named by role, never by tracker id:
      * a patient's flag keeps its kind and is labelled "patient" ("the patient's ...")
      * a caregiver's trunk-tilt flag becomes unsafe_caregiver_posture, labelled "caregiver"
        (a bent back is an ergonomic risk to the caregiver, not a sign the patient is unsteady)
      * a caregiver's off-centre flag is dropped: caregivers shift their weight on purpose
      * a track with no known caregiver or patient role becomes kind "other" with no
        person_label; its description already says "a person". It does not claim to be
        about the patient.
    Flags without a "track N" label (already named) are kept as they are. The result keeps
    patient flags first, then caregiver flags, then the rest, each strongest first.
    """
    roles = {t["person_idx"]: t["role"] for t in repo.get_tracks(video_id)}
    out: list[SafetyFlag] = []
    for flag in flags:
        idx = _track_of(flag)
        if idx is None:
            out.append(flag)
            continue
        role = roles.get(idx, "unknown")
        if role == "patient":
            out.append(_renamed(flag, idx, "the patient", person_label="patient"))
        elif role == "caregiver":
            if flag.kind == "patient_unsteady":
                out.append(_renamed(flag, idx, "the caregiver", person_label="caregiver",
                                    kind="unsafe_caregiver_posture"))
        else:
            out.append(_renamed(flag, idx, UNNAMED, person_label=None, kind="other"))
    rank = {"unsafe_caregiver_posture": 1, "other": 2}
    out.sort(key=lambda f: rank.get(f.kind, 0))  # stable: keeps strongest-first within each group
    return out[:MAX_FLAGS]


# --- roles ----------------------------------------------------------------
MAX_ROLE_FRAMES = 3     # stills sent, in a single call
MIN_ROLE_SECONDS = 1.0  # tracks spanning less time than this are not worth asking about
MIN_ROLE_IOU = 0.2
ROLE_IMAGE_WIDTH = 640


class RoleBox(BaseModel):
    label: str = Field(description="label from the list of people when one matches, else a new label")
    role: Literal["caregiver", "patient", "other"]
    box_2d: list[int] = Field(description="[ymin, xmin, ymax, xmax] on a 0-1000 scale around the whole person")


class FrameRoles(BaseModel):
    image: int = Field(description="the image number, from 1")
    people: list[RoleBox]


class RoleFrames(BaseModel):
    images: list[FrameRoles]


def assign_roles(ctx, people: list[PersonObs]) -> None:
    """Label pose tracks as caregiver, patient or other and store them with repo.set_track_roles.

    One person and no patient: every track is that caregiver, with no Gemini call.
    Otherwise up to MAX_ROLE_FRAMES stills are picked, each at a time when as many tracks not
    yet covered as possible are visible, and sent to Gemini together in one call. The boxes it
    returns for each still are matched to the track boxes by overlap. Tracks that cannot be
    matched stay 'unknown'."""
    tracks = [t for t in repo.get_tracks(ctx.video_id) if t["last_t"] - t["first_t"] >= MIN_ROLE_SECONDS]
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
    stills = pick_stills(by_time, tracks)
    if not stills:
        return
    try:
        found = _ask_roles(ctx, [t for t, _ in stills], people)
    except gemini.GeminiError as exc:
        ctx.log(f"roles: Gemini call failed: {exc}")
        return
    roles: dict[int, str] = {}
    for k, (_, present) in enumerate(stills):
        for idx, role in _match_roles(present, found.get(k + 1, [])).items():
            roles.setdefault(idx, role)
    if roles:
        repo.set_track_roles(ctx.video_id, roles)


def pick_stills(by_time: dict[float, dict[int, dict]], tracks: list[dict],
                limit: int = MAX_ROLE_FRAMES) -> list[tuple[float, dict[int, dict]]]:
    """Up to limit (time, {person_idx: frame}) stills that between them show every track that
    can be shown: the largest track not yet covered anchors each still, at the time when most
    uncovered tracks are in view."""
    pending = {t["person_idx"]: t for t in tracks}
    stills = []
    while pending and len(stills) < limit:
        anchor = max(pending.values(), key=lambda t: t["n_frames"])
        t = _best_time(by_time, anchor, set(pending))
        if t is None:
            pending.pop(anchor["person_idx"])
            continue
        present = {k: v for k, v in by_time[t].items() if k in pending}
        stills.append((t, present))
        for k in present:
            pending.pop(k, None)
    return stills


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


def _ask_roles(ctx, times: list[float], people: list[PersonObs]) -> dict[int, list[RoleBox]]:
    """One Gemini call over the stills at times; returns the boxes for each image number (from 1)."""
    listed = "\n".join(f"- {p.label} ({p.role}): {p.description}" for p in people) or "- (no description available)"
    parts: list[dict] = []
    for k, t in enumerate(times, start=1):
        parts += [gemini.text_part(f"Image {k}, at {t:.1f} s:"), gemini.image_part(ctx.frame_jpeg(t, ROLE_IMAGE_WIDTH), resolution="medium")]
    parts.append(gemini.text_part(
        f"{'These are still frames' if len(times) > 1 else 'This is one still frame'} from a caregiving video. "
        f"Earlier analysis of the video described these people:\n{listed}\n\n"
        "For each image, return one entry for every person visible in it, including people only partly in view. "
        "For each person give box_2d = [ymin, xmin, ymax, xmax] on a 0-1000 scale around the whole visible body, "
        "role = caregiver (the person giving help), patient (the person being helped) or other, "
        "and label = the matching label from the list above."
    ))
    # A few still frames: it answers in seconds, so a request that hangs is given up on early
    # and retried rather than holding a caregiver's result for the default ten minutes.
    reply = ctx.generate_json("pose_roles", parts, RoleFrames, model="main", thinking="low", max_output_tokens=3000,
                              expect_output_tokens=800, timeout=ROLES_TIMEOUT_S)
    out: dict[int, list[RoleBox]] = {}
    for frame in reply.images:
        out.setdefault(frame.image, [p for p in frame.people if len(p.box_2d) == 4])
    return out


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
