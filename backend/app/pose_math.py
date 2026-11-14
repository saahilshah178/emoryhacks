"""Joint angles, balance readings, person tracking and cut detection for the pose stage.

Small pure functions over MediaPipe Pose landmarks, so each formula can be unit tested
on synthetic points. Conventions:
  * xy: (33, 2) landmarks in normalised image coordinates (0..1, y grows downwards)
  * vis: (33,) MediaPipe visibility per landmark (0..1)
  * world: (33, 3) MediaPipe world landmarks in metres, origin between the hips, y down
  * aspect: frame width / height. Geometry in the image plane multiplies x by aspect so
    that angles are measured in true pixel proportions.

What a single 2D camera can and cannot tell you:
  * joint angles and trunk tilt use MediaPipe's world landmarks, whose depth is inferred
    by the model rather than measured. Bends across the image are reliable to a few
    degrees; bends towards or away from the camera are approximate (expect +-15 degrees).
    All of them are relative to the camera's vertical, so a tilted camera biases them.
  * trunk_lateral, the centre of mass and the base of support are measured in the image
    plane only. com_offset therefore shows side-to-side balance when the person faces the
    camera and front-to-back balance when they are side-on, never both at once.
  * balance readings need both legs and feet visible and are only computed while the
    person is standing (is_standing): seated, kneeling or lying people have no meaningful
    base of support under the feet. The pose stage further keeps them only inside
    stable_runs of standing frames, so a single frame that happens to pass is ignored.
"""
from __future__ import annotations

import math
from typing import Sequence

import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment

# MediaPipe Pose landmark indices.
NOSE = 0
L_EAR, R_EAR = 7, 8
L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW, R_ELBOW = 13, 14
L_WRIST, R_WRIST = 15, 16
L_INDEX, R_INDEX = 19, 20
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26
L_ANKLE, R_ANKLE = 27, 28
L_HEEL, R_HEEL = 29, 30
L_TOE, R_TOE = 31, 32  # MediaPipe calls these "foot index"
N_LANDMARKS = 33

# Virtual points appended after the 33 landmarks by _with_midpoints().
SHOULDER_MID, HIP_MID, EAR_MID = 33, 34, 35

VISIBLE = 0.5             # a landmark counts as seen above this visibility
# A frame is valid when at least MIN_VALID_LANDMARKS of the body joints (shoulders down to
# toes) are seen. Face and finger points do not count: a close-up of two hands alone shows
# 8 finger and wrist points without any body to measure.
MIN_VALID_LANDMARKS = 8
BODY_LANDMARKS = [*range(L_SHOULDER, R_WRIST + 1), *range(L_HIP, R_TOE + 1)]
UPSIDE_DOWN_DEG = 135     # a trunk further than this from upright in the image is a false detection
# Standing (weight on the feet), per frame. A seated person seen from a raised three-quarter
# camera has foreshortened thighs that MediaPipe can put at 40-45 degrees from vertical, so
# the thigh test alone is not enough: the knees must also be nearly straight.
STANDING_MAX_THIGH_DEG = 35.0  # mean thigh angle from vertical, world landmarks
STANDING_MIN_KNEE_DEG = 130.0  # both knees at least this straight (180 is straight)
LYING_TILT_DEG = 75.0          # a trunk this far from upright is lying down, not standing
# The foot landmarks run down the middle of each foot, so the base of support is widened
# by half a foot's width (about 5 cm, a tenth of a 50 cm torso) on each side.
FOOT_HALF_WIDTH_TORSO = 0.1

# Joint angle columns: (proximal point, joint, distal point). 180 degrees is straight.
JOINTS: dict[str, tuple[int, int, int]] = {
    "l_elbow": (L_SHOULDER, L_ELBOW, L_WRIST),
    "r_elbow": (R_SHOULDER, R_ELBOW, R_WRIST),
    "l_shoulder": (L_HIP, L_SHOULDER, L_ELBOW),  # arm against the trunk: 0 is arm at the side
    "r_shoulder": (R_HIP, R_SHOULDER, R_ELBOW),
    "l_hip": (L_SHOULDER, L_HIP, L_KNEE),
    "r_hip": (R_SHOULDER, R_HIP, R_KNEE),
    "l_knee": (L_HIP, L_KNEE, L_ANKLE),
    "r_knee": (R_HIP, R_KNEE, R_ANKLE),
    "l_ankle": (L_KNEE, L_ANKLE, L_TOE),
    "r_ankle": (R_KNEE, R_ANKLE, R_TOE),
}

# Body segments for the centre of mass: (proximal, distal, mass fraction, centre position
# from proximal along the segment). Fractions from Winter, Biomechanics and Motor Control
# of Human Movement (2009); they sum to 1.
SEGMENTS: list[tuple[int, int, float, float]] = [
    (EAR_MID, EAR_MID, 0.081, 0.0),          # head and neck
    (SHOULDER_MID, HIP_MID, 0.497, 0.5),     # trunk
    (L_SHOULDER, L_ELBOW, 0.028, 0.436), (R_SHOULDER, R_ELBOW, 0.028, 0.436),  # upper arms
    (L_ELBOW, L_WRIST, 0.016, 0.430), (R_ELBOW, R_WRIST, 0.016, 0.430),        # forearms
    (L_WRIST, L_INDEX, 0.006, 0.506), (R_WRIST, R_INDEX, 0.006, 0.506),        # hands
    (L_HIP, L_KNEE, 0.100, 0.433), (R_HIP, R_KNEE, 0.100, 0.433),              # thighs
    (L_KNEE, L_ANKLE, 0.0465, 0.433), (R_KNEE, R_ANKLE, 0.0465, 0.433),        # shanks
    (L_HEEL, L_TOE, 0.0145, 0.5), (R_HEEL, R_TOE, 0.0145, 0.5),                # feet
]
# Segments that must be seen for a centre of mass: trunk, thighs and shanks (87% of mass).
REQUIRED_SEGMENTS = {1, 8, 9, 10, 11}
FEET = ((L_ANKLE, L_HEEL, L_TOE), (R_ANKLE, R_HEEL, R_TOE))


# --- geometry ------------------------------------------------------------
def _with_midpoints(points: np.ndarray, vis: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Append shoulder, hip and ear midpoints; a midpoint is as visible as its weaker end."""
    pairs = ((L_SHOULDER, R_SHOULDER), (L_HIP, R_HIP), (L_EAR, R_EAR))
    mids = np.array([(points[a] + points[b]) / 2 for a, b in pairs])
    mid_vis = np.array([min(vis[a], vis[b]) for a, b in pairs])
    return np.vstack([points, mids]), np.concatenate([vis, mid_vis])


def _seen(vis: np.ndarray, *idx: int) -> bool:
    return all(vis[i] > VISIBLE for i in idx)


def joint_angle(a: Sequence[float], b: Sequence[float], c: Sequence[float]) -> float | None:
    """Angle at b between b->a and b->c in degrees (0..180), in 2D or 3D. None if degenerate."""
    u, v = np.asarray(a, float) - np.asarray(b, float), np.asarray(c, float) - np.asarray(b, float)
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    if nu < 1e-9 or nv < 1e-9:
        return None
    return math.degrees(math.acos(float(np.clip(np.dot(u, v) / (nu * nv), -1.0, 1.0))))


def angle_from_vertical(lower: Sequence[float], upper: Sequence[float]) -> float | None:
    """Angle in degrees between the lower->upper line and straight up (y is down, 2D or 3D).
    0 is upright, 90 is horizontal."""
    d = np.asarray(upper, float) - np.asarray(lower, float)
    up = np.zeros_like(d)
    up[1] = -1.0
    n = np.linalg.norm(d)
    if n < 1e-9:
        return None
    return math.degrees(math.acos(float(np.clip(np.dot(d, up) / n, -1.0, 1.0))))


def lateral_lean(lower: Sequence[float], upper: Sequence[float]) -> float | None:
    """Signed lean of the lower->upper line in the image plane, in degrees.
    Positive means the upper point is to the right of the lower one in the image."""
    dx, dy = float(upper[0]) - float(lower[0]), float(upper[1]) - float(lower[1])
    if abs(dx) < 1e-9 and abs(dy) < 1e-9:
        return None
    return math.degrees(math.atan2(dx, -dy))


def torso_length(img: np.ndarray, vis: np.ndarray) -> float | None:
    """Shoulder-midpoint to hip-midpoint distance in aspect-corrected image units."""
    if not _seen(vis, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP):
        return None
    shoulders = (img[L_SHOULDER] + img[R_SHOULDER]) / 2
    hips = (img[L_HIP] + img[R_HIP]) / 2
    length = float(np.linalg.norm(shoulders - hips))
    return length if length > 1e-6 else None


def is_standing(body: np.ndarray, img: np.ndarray, vis: np.ndarray) -> bool:
    """True when this one frame looks like a person standing on their feet: both legs seen,
    thighs within STANDING_MAX_THIGH_DEG of vertical on average, both knees at least
    STANDING_MIN_KNEE_DEG straight, the trunk short of lying flat, and in the image each hip
    above its knee and each knee above its ankle (which rules out lying across the frame).
    body holds the points angles are measured on (world landmarks); img the aspect-corrected
    image points."""
    legs = ((L_HIP, L_KNEE, L_ANKLE), (R_HIP, R_KNEE, R_ANKLE))
    if not _seen(vis, L_SHOULDER, R_SHOULDER, *legs[0], *legs[1]):
        return False
    if not all(img[h][1] < img[k][1] < img[a][1] for h, k, a in legs):
        return False
    thighs = [angle_from_vertical(body[k], body[h]) for h, k, _ in legs]
    knees = [joint_angle(body[h], body[k], body[a]) for h, k, a in legs]
    pts, _ = _with_midpoints(body, vis)
    tilt = angle_from_vertical(pts[HIP_MID], pts[SHOULDER_MID])
    if any(v is None for v in (*thighs, *knees, tilt)):
        return False
    return (sum(thighs) / 2 <= STANDING_MAX_THIGH_DEG and min(knees) >= STANDING_MIN_KNEE_DEG
            and tilt < LYING_TILT_DEG)


def centre_of_mass(xy: np.ndarray, vis: np.ndarray) -> tuple[float, float] | None:
    """Whole-body centre of mass in normalised image coordinates, from segment mass fractions.
    Needs the trunk, thighs and shanks; unseen arms, head or feet are left out and the
    remaining weights rescaled. None when a required segment is not seen."""
    pts, v = _with_midpoints(np.asarray(xy, float), np.asarray(vis, float))
    total, acc = 0.0, np.zeros(2)
    for i, (prox, dist, mass, frac) in enumerate(SEGMENTS):
        if not _seen(v, prox, dist):
            if i in REQUIRED_SEGMENTS:
                return None
            continue
        acc += mass * (pts[prox] + frac * (pts[dist] - pts[prox]))
        total += mass
    com = acc / total
    return float(com[0]), float(com[1])


def base_of_support(xy: np.ndarray, vis: np.ndarray, margin: float = 0.0) -> tuple[float, float] | None:
    """(centre x, width) spanned by the seen ankle, heel and toe points, in normalised image x,
    widened by margin on each side. Needs at least one point of each foot."""
    xs = []
    for foot in FEET:
        seen = [float(xy[i][0]) for i in foot if vis[i] > VISIBLE]
        if not seen:
            return None
        xs += seen
    lo, hi = min(xs), max(xs)
    return (lo + hi) / 2, hi - lo + 2 * margin


def com_offset(com_x: float, bos_center_x: float, bos_width: float) -> float:
    """Signed distance of the centre of mass from the middle of the base of support, in
    half-widths: |value| < 1 means it lies over the feet."""
    return (com_x - bos_center_x) / (bos_width / 2)


def balance_score(offset: float) -> float:
    """1 when the centre of mass is centred over the feet, 0 at or beyond their edge."""
    return 1.0 - min(1.0, abs(offset))


def sway_velocity(prev_com: Sequence[float], com: Sequence[float], dt: float, torso: float) -> float | None:
    """Speed of the centre of mass in torso lengths per second (aspect-corrected inputs)."""
    if dt <= 0 or not torso:
        return None
    return float(np.linalg.norm(np.asarray(com, float) - np.asarray(prev_com, float))) / dt / torso


def bounding_box(xy: np.ndarray, vis: np.ndarray) -> tuple[float, float, float, float]:
    """(x0, y0, x1, y1) around the seen landmarks (all of them if none is seen), clipped to 0..1."""
    pts = np.asarray(xy, float)
    seen = pts[np.asarray(vis) > VISIBLE]
    if len(seen) == 0:
        seen = pts
    x0, y0 = np.clip(seen.min(axis=0), 0, 1)
    x1, y1 = np.clip(seen.max(axis=0), 0, 1)
    return float(x0), float(y0), float(x1), float(y1)


def is_valid(img: np.ndarray, vis: np.ndarray) -> bool:
    """Enough body joints are seen to measure, and the trunk, if seen, is not upside down."""
    if int((vis[BODY_LANDMARKS] > VISIBLE).sum()) < MIN_VALID_LANDMARKS:
        return False
    if _seen(vis, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP):
        pts, _ = _with_midpoints(img, vis)
        tilt = angle_from_vertical(pts[HIP_MID], pts[SHOULDER_MID])
        return tilt is not None and tilt < UPSIDE_DOWN_DEG
    return True


def frame_readings(xy: np.ndarray, vis: np.ndarray, world: np.ndarray | None, aspect: float) -> dict:
    """All per-frame pose_frames readings for one person except sway_velocity and ids, plus
    "standing" (is_standing for this frame; not a stored column). Balance readings (bos_*,
    com_offset, balance_score) are only given for a standing frame.
    world=None measures angles in the image plane instead (used by tests)."""
    xy, vis = np.asarray(xy, float), np.asarray(vis, float)
    img = xy * np.array([aspect, 1.0])
    x0, y0, x1, y1 = bounding_box(xy, vis)
    row: dict = {"valid": is_valid(img, vis), "visibility": float(vis.mean()), "standing": False,
                 "bbox_x0": x0, "bbox_y0": y0, "bbox_x1": x1, "bbox_y1": y1}
    if not row["valid"]:
        return row
    body = np.asarray(world, float) if world is not None else img
    for name, (a, b, c) in JOINTS.items():
        row[name] = joint_angle(body[a], body[b], body[c]) if _seen(vis, a, b, c) else None
    if _seen(vis, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP):
        pts, _ = _with_midpoints(body, vis)
        ipts, _ = _with_midpoints(img, vis)
        row["trunk_tilt"] = angle_from_vertical(pts[HIP_MID], pts[SHOULDER_MID])
        row["trunk_lateral"] = lateral_lean(ipts[HIP_MID], ipts[SHOULDER_MID])
    com = centre_of_mass(xy, vis)
    if com is not None:
        row["com_x"], row["com_y"] = com
    torso = torso_length(img, vis)
    row["standing"] = is_standing(body, img, vis)
    if com is not None and torso and row["standing"]:
        bos = base_of_support(xy, vis, margin=FOOT_HALF_WIDTH_TORSO * torso / aspect)
        if bos is not None:
            row["bos_center_x"], row["bos_width"] = bos
            row["com_offset"] = com_offset(com[0], *bos)
            row["balance_score"] = balance_score(row["com_offset"])
    return row


# --- tracking ------------------------------------------------------------
def box_iou(a: Sequence[float], b: Sequence[float]) -> float:
    """Intersection over union of two (x0, y0, x1, y1) boxes."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _centre_distance(a: Sequence[float], b: Sequence[float]) -> float:
    """Distance between box centres divided by the mean box diagonal."""
    ca = np.array([(a[0] + a[2]) / 2, (a[1] + a[3]) / 2])
    cb = np.array([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])
    diag = (math.hypot(a[2] - a[0], a[3] - a[1]) + math.hypot(b[2] - b[0], b[3] - b[1])) / 2
    return float(np.linalg.norm(ca - cb)) / max(diag, 1e-6)


def match_boxes(a: list, b: list, min_iou: float = 0.1, max_centre_dist: float = 0.5) -> list[tuple[int, int]]:
    """Hungarian assignment between two box lists on overlap and centre distance.
    A pair is allowed when it overlaps by min_iou or its centres are within
    max_centre_dist mean diagonals. Returns (index in a, index in b) pairs."""
    if not a or not b:
        return []
    blocked = 1e6
    cost = np.full((len(a), len(b)), blocked)
    for i, ba in enumerate(a):
        for j, bb in enumerate(b):
            iou, dist = box_iou(ba, bb), _centre_distance(ba, bb)
            if iou >= min_iou or dist <= max_centre_dist:
                cost[i, j] = (1 - iou) + dist
    rows, cols = linear_sum_assignment(cost)
    return [(int(i), int(j)) for i, j in zip(rows, cols) if cost[i, j] < blocked]


# Tracker gates. MediaPipe's video mode can slide from one person to another who overlaps
# them (a caregiver standing behind a seated patient) within a frame or two; the box barely
# moves, but the shoulders, hips and knees jump by about half a torso. A match that moves
# or resizes more than this starts a new track instead.
TRACK_MIN_IOU = 0.3           # boxes must overlap at least this much when no body points compare
TRACK_MAX_RESIZE = 0.35       # torso length (or box diagonal) may change by this fraction
TRACK_MAX_JUMP_TORSO = 0.35   # mean move of seen shoulders, hips and knees, in torso lengths...
TRACK_SPEED_TORSO_S = 1.0     # ...plus this many torso lengths per second since last seen
TRACK_POINTS = (L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_KNEE, R_KNEE)


def _diagonal(box: Sequence[float]) -> float:
    return math.hypot(box[2] - box[0], box[3] - box[1])


def _ratio(a: float, b: float) -> float:
    return max(a, b) / max(min(a, b), 1e-9)


def same_person(prev: dict, new: dict, dt: float) -> bool:
    """Whether detection `new` can be the person last seen as `prev`, dt seconds earlier.
    Each is {"box": (x0, y0, x1, y1), "img": aspect-corrected (33, 2) points or None,
    "vis": (33,) visibility or None}. With at least three body points seen in both, the
    points must not jump (TRACK_MAX_JUMP_TORSO plus TRACK_SPEED_TORSO_S * dt) and the torso
    must not resize by more than TRACK_MAX_RESIZE; otherwise the boxes must overlap by
    TRACK_MIN_IOU and not resize by more than TRACK_MAX_RESIZE."""
    if prev.get("img") is not None and new.get("img") is not None:
        both = [i for i in TRACK_POINTS if prev["vis"][i] > VISIBLE and new["vis"][i] > VISIBLE]
        torsos = [torso_length(prev["img"], prev["vis"]), torso_length(new["img"], new["vis"])]
        if len(both) >= 3 and all(torsos):
            if _ratio(*torsos) > 1 + TRACK_MAX_RESIZE:
                return False
            jump = float(np.mean([np.linalg.norm(new["img"][i] - prev["img"][i]) for i in both]))
            return jump / (sum(torsos) / 2) <= TRACK_MAX_JUMP_TORSO + TRACK_SPEED_TORSO_S * max(dt, 0.0)
    return (box_iou(prev["box"], new["box"]) >= TRACK_MIN_IOU
            and _ratio(_diagonal(prev["box"]), _diagonal(new["box"])) <= 1 + TRACK_MAX_RESIZE)


class BoxTracker:
    """Gives each detected person a track id that stays the same from frame to frame.

    Detections are matched to open tracks by box overlap (Hungarian assignment), but only
    where same_person allows it, so a detection that jumps to someone else starts a new id.
    Ids are unique for the tracker's lifetime: reset() (on a camera cut) forgets the open
    tracks but keeps counting, and a track unseen for more than max_gap_s ends."""

    def __init__(self, max_gap_s: float = 1.0):
        self.max_gap_s = max_gap_s
        self.next_id = 0
        self.tracks: dict[int, dict] = {}  # id -> {"box", "img", "vis", "t"} when last seen

    def reset(self) -> None:
        self.tracks.clear()

    def update(self, t: float, boxes: list, bodies: list | None = None) -> list[int]:
        """Assign a track id to each box seen at time t, in the order given. bodies, when
        given, holds (aspect-corrected image points, visibility) for each box."""
        self.tracks = {k: v for k, v in self.tracks.items() if t - v["t"] <= self.max_gap_s}
        found = [{"box": tuple(b), "img": None, "vis": None, "t": t} for b in boxes]
        for d, body in zip(found, bodies or []):
            d["img"], d["vis"] = (np.asarray(body[0], float), np.asarray(body[1], float))
        ids = list(self.tracks)
        out: list[int | None] = [None] * len(boxes)
        if ids and found:
            blocked = 1e6
            cost = np.full((len(ids), len(found)), blocked)
            for i, k in enumerate(ids):
                prev = self.tracks[k]
                for j, d in enumerate(found):
                    if same_person(prev, d, t - prev["t"]):
                        cost[i, j] = (1 - box_iou(prev["box"], d["box"])) + _centre_distance(prev["box"], d["box"])
            for i, j in zip(*linear_sum_assignment(cost)):
                if cost[i, j] < blocked:
                    out[j] = ids[i]
        for j, d in enumerate(found):
            if out[j] is None:
                out[j] = self.next_id
                self.next_id += 1
            self.tracks[out[j]] = d
        return out  # type: ignore[return-value]


def drop_duplicates(boxes: list, scores: list[float], max_iou: float = 0.5) -> list[int]:
    """Indices of boxes to keep, dropping any that overlaps a better-scoring one."""
    keep: list[int] = []
    for i in sorted(range(len(boxes)), key=lambda k: -scores[k]):
        if all(box_iou(boxes[i], boxes[k]) < max_iou for k in keep):
            keep.append(i)
    return sorted(keep)


# --- camera cuts ---------------------------------------------------------
CUT_CORRELATION = 0.5  # hue/saturation histogram correlation below this between samples is a cut


def colour_histogram(bgr: np.ndarray) -> np.ndarray:
    """Normalised hue/saturation histogram of a BGR frame."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
    return cv2.normalize(hist, hist).flatten()


BLANK_BRIGHTNESS = 16  # mean grey level below this is a black frame (a fade between shots)


def is_cut(prev_hist: np.ndarray, hist: np.ndarray, threshold: float = CUT_CORRELATION) -> bool:
    """True when two consecutive sampled frames look like different shots."""
    return cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL) < threshold


def is_blank(bgr: np.ndarray, max_brightness: float = BLANK_BRIGHTNESS) -> bool:
    """True for a (nearly) black frame. A fade through black changes the shot too gradually
    for is_cut, so the pose stage starts a new segment after any blank frame."""
    return float(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).mean()) < max_brightness


def core_seen(vis: np.ndarray) -> bool:
    """Both shoulders and both hips are seen."""
    return _seen(vis, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP)


# --- sustained windows ---------------------------------------------------
def sustained_windows(times: Sequence[float], mask: Sequence[bool], min_duration: float,
                      max_gap: float) -> list[list[int]]:
    """Group the indices where mask is true into windows, allowing breaks up to max_gap
    seconds, and keep windows lasting at least min_duration seconds. times must be sorted."""
    windows: list[list[int]] = []
    current: list[int] = []
    for i, (t, on) in enumerate(zip(times, mask)):
        if not on:
            continue
        if current and t - times[current[-1]] > max_gap:
            windows.append(current)
            current = []
        current.append(i)
    if current:
        windows.append(current)
    return [w for w in windows if times[w[-1]] - times[w[0]] >= min_duration]


def stable_runs(times: Sequence[float], mask: Sequence[bool], min_duration: float,
                max_gap: float) -> list[list[int]]:
    """Runs of consecutive indices where mask is true, lasting at least min_duration seconds.
    Unlike sustained_windows, any false entry ends a run; only a gap in time with no entry
    at all (the person not detected) up to max_gap seconds is bridged. times must be sorted."""
    runs: list[list[int]] = []
    current: list[int] = []
    for i, (t, on) in enumerate(zip(times, mask)):
        if current and (not on or t - times[current[-1]] > max_gap):
            runs.append(current)
            current = []
        if on:
            current.append(i)
    if current:
        runs.append(current)
    return [r for r in runs if times[r[-1]] - times[r[0]] >= min_duration]
