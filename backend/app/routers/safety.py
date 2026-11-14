"""Safety dashboard queries over the pose time series in Tiger Data.
Owned by branch feat/pose-tiger. Every number here is read from TimescaleDB: the
pose_frames hypertable, its pose_1s continuous aggregate, and toolkit aggregates.

GET /api/safety/overview                 one row per video with pose data, with per-role readings
GET /api/safety/videos/{id}/series       per-person series over video time (?bucket_s=, gap-filled)
GET /api/safety/videos/{id}/frames       per-frame series for chosen metrics, downsampled with lttb
GET /api/safety/videos/{id}/summary      tracks with roles and statistics, flags, pose windows, thresholds
GET /api/safety/trends                   readings across attempts over calendar time, by skill
GET /api/safety/storage                  hypertable, chunk, columnstore and rollup facts
"""
from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, HTTPException, Query

from .. import db, repo
from ..stages import pose

router = APIRouter(prefix="/safety", tags=["safety"])

THRESHOLDS = {
    "off_center_offset": pose.OFF_CENTER_OFFSET,  # |com_offset| above this: centre of mass outside the feet
    "balance_low": 0.25,                          # balance_score below this is shaded on the chart
    "tilt_caution": 20.0,                         # trunk tilt bands on the chart
    "tilt_bent": 60.0,                            # caregiver "bent over" share uses this
    "flag_tilt": pose.FLAG_TILT_DEG,
    "lying_tilt": pose.LYING_TILT_DEG,
    "flag_min_seconds": pose.FLAG_MIN_SECONDS,
    "min_standing_s": 1.0,                        # balance figures need at least this much standing time
}
# Per-frame metrics a client may ask /frames for.
FRAME_METRICS = [k for k in repo.POSE_ROW_KEYS if k not in ("person_idx", "t_offset", "segment_id", "valid")]

# Frame counts and readings per role over pose_frames f joined to pose_tracks t. Balance
# readings exist only for frames where the person was standing with both feet in view
# (pose.keep_standing_balance), so count(com_offset) counts standing frames. _role_figures
# turns the counts into seconds and shares. percentile_agg is from the TimescaleDB toolkit.
_ROLE_COUNTS = """
  count(*) FILTER (WHERE f.valid) AS valid_frames,
  count(*) FILTER (WHERE f.valid AND t.role IN ('patient', 'caregiver')) AS role_frames,
  count(*) FILTER (WHERE f.valid AND t.role = 'patient') AS patient_frames,
  count(f.com_offset) FILTER (WHERE f.valid AND t.role = 'patient') AS patient_standing_frames,
  count(*) FILTER (WHERE f.valid AND t.role = 'patient' AND abs(f.com_offset) > %(off)s) AS patient_off_frames,
  min(f.balance_score) FILTER (WHERE f.valid AND t.role = 'patient') AS patient_balance_min,
  avg(f.balance_score) FILTER (WHERE f.valid AND t.role = 'patient') AS patient_balance_avg,
  count(f.trunk_tilt) FILTER (WHERE f.valid AND t.role = 'caregiver') AS caregiver_frames,
  count(*) FILTER (WHERE f.valid AND t.role = 'caregiver' AND f.trunk_tilt > %(bent)s) AS caregiver_bent_frames,
  avg(f.trunk_tilt) FILTER (WHERE f.valid AND t.role = 'caregiver') AS caregiver_tilt_avg,
  approx_percentile(0.95, percentile_agg(f.trunk_tilt) FILTER (WHERE f.valid AND t.role = 'caregiver'))
    AS caregiver_tilt_peak
"""
_PARAMS = {"off": THRESHOLDS["off_center_offset"], "bent": THRESHOLDS["tilt_bent"]}

# Measured frames per second for each video: one over the median time between a track's
# consecutive rows. Compared with videos.fps it says whether every frame was measured.
_SAMPLE_RATE = """
  SELECT video_id, 1 / nullif(percentile_cont(0.5) WITHIN GROUP (ORDER BY dt), 0) AS sample_fps
  FROM (SELECT video_id, t_offset - lag(t_offset) OVER (PARTITION BY video_id, person_idx ORDER BY t_offset) AS dt
        FROM pose_frames {where}) steps
  WHERE dt > 0 GROUP BY video_id"""
_ALL_SAMPLE_RATES = _SAMPLE_RATE.format(where="")


def _rounded(rows: list[dict], places: int = 3) -> list[dict]:
    """Floats rounded, and NaN (e.g. the standard deviation of a single frame) as None, which JSON allows."""
    return [{k: (None if v != v else round(v, places)) if isinstance(v, float) else v for k, v in r.items()}
            for r in rows]


def _sampling(sample_fps: float | None, video_fps: float | None) -> dict:
    """How densely a video was measured: every frame, or a stated rate."""
    every = bool(sample_fps and video_fps and sample_fps >= 0.95 * video_fps)
    return {"sample_fps": sample_fps, "video_fps": video_fps, "every_frame": every}


def _role_figures(row: dict) -> dict:
    """Replace the _ROLE_COUNTS frame counts in row with seconds and shares a nurse can read.

    patient_tracked_s is how long the patient was measured at all, and patient_standing_s how
    long they were seen standing with both feet in view; the
    patient's balance average, lowest and off-centre share are shares of that time, and are
    None when it is under THRESHOLDS["min_standing_s"] (there is nothing to judge, so neither
    0 nor 100 percent is true). caregiver_bent_share is a share of caregiver_tracked_s.
    role_share is the share of measured person-frames whose person has a known role."""
    fps = row.get("sample_fps") or 0
    seconds = (lambda n: (n or 0) / fps) if fps else (lambda n: None)
    patient, standing, off = row.pop("patient_frames"), row.pop("patient_standing_frames"), row.pop("patient_off_frames")
    tracked, bent = row.pop("caregiver_frames"), row.pop("caregiver_bent_frames")
    valid, labelled = row.pop("valid_frames"), row.pop("role_frames")
    row["patient_tracked_s"] = seconds(patient)
    row["patient_standing_s"], row["patient_off_center_s"] = seconds(standing), seconds(off)
    enough = row["patient_standing_s"] is not None and row["patient_standing_s"] >= THRESHOLDS["min_standing_s"]
    row["patient_off_center_share"] = off / standing if enough else None
    if not enough:
        row["patient_balance_avg"] = row["patient_balance_min"] = None
    row["caregiver_tracked_s"] = seconds(tracked)
    row["caregiver_bent_share"] = bent / tracked if tracked else None
    row["role_share"] = labelled / valid if valid else None
    return row


def _video_or_404(video_id: str) -> dict:
    try:
        video = repo.get_video(uuid.UUID(video_id))
    except ValueError:
        video = None
    if not video:
        raise HTTPException(404, "Video not found")
    return video


@router.get("/overview")
def overview():
    """One row per video with pose data: what it is, how densely it was measured, the pose_1s
    rollup, per-role readings with the time they cover (_role_figures), and safety-flag
    counts. Peak trunk tilt is the 95th percentile, robust to single bad frames. Attempts
    whose skill was deleted are left out; skill_match False marks an attempt rejected as
    the wrong skill."""
    rows = db.fetch_all(
        f"""WITH roll AS (
              SELECT video_id, count(DISTINCT bucket) AS seconds_tracked, avg(balance_avg) AS balance_avg,
                     min(balance_min) AS balance_min, max(trunk_tilt_max) AS trunk_tilt_max
              FROM pose_1s GROUP BY video_id),
            rate AS ({_ALL_SAMPLE_RATES}),
            roles AS (
              SELECT f.video_id, count(*) AS person_frames, count(DISTINCT f.person_idx) AS tracks,
                     {_ROLE_COUNTS}
              FROM pose_frames f LEFT JOIN pose_tracks t ON t.video_id = f.video_id AND t.person_idx = f.person_idx
              GROUP BY f.video_id)
            SELECT v.id AS video_id, v.kind, v.original_name, v.duration_s, v.recorded_at, v.fps AS video_fps,
                   q.sample_fps,
                   a.id AS attempt_id, a.caregiver_name, coalesce(a.nurse_status, a.status) AS attempt_status,
                   a.score_pct, a.skill_match,
                   coalesce(sa.name, sr.name) AS skill_name, coalesce(sa.slug, sr.slug) AS skill_slug,
                   r.seconds_tracked, r.balance_avg, r.balance_min, r.trunk_tilt_max,
                   x.person_frames, x.tracks, x.valid_frames, x.role_frames,
                   x.patient_frames, x.patient_standing_frames, x.patient_off_frames,
                   x.patient_balance_min, x.patient_balance_avg,
                   x.caregiver_frames, x.caregiver_bent_frames, x.caregiver_tilt_avg, x.caregiver_tilt_peak,
                   (SELECT count(*) FROM safety_flags sf WHERE sf.video_id = v.id) AS flag_count,
                   (SELECT count(*) FROM safety_flags sf WHERE sf.video_id = v.id AND sf.counts_toward_score)
                     AS scored_flag_count,
                   (SELECT count(*) FROM safety_flags sf WHERE sf.video_id = v.id AND sf.severity = 'high')
                     AS high_flag_count
            FROM roll r JOIN videos v ON v.id = r.video_id
            LEFT JOIN roles x ON x.video_id = v.id
            LEFT JOIN rate q ON q.video_id = v.id
            LEFT JOIN attempts a ON a.video_id = v.id
            LEFT JOIN skills sa ON sa.id = a.skill_id
            LEFT JOIN LATERAL (SELECT name, slug FROM skills s WHERE s.reference_video_id = v.id
                               ORDER BY s.version DESC LIMIT 1) sr ON true
            WHERE NOT (v.kind = 'attempt' AND a.id IS NULL)
            ORDER BY v.recorded_at DESC""",
        _PARAMS,
    )
    for r in rows:
        r["every_frame"] = _sampling(r["sample_fps"], r["video_fps"])["every_frame"]
        _role_figures(r)
    return _rounded(rows)


_SERIES_FROM_ROLLUP = """
    SELECT time_bucket_gapfill(%(width)s::interval, p.bucket, %(start)s::timestamptz, %(finish)s::timestamptz) AS b,
           p.person_idx, sum(p.n_valid) AS n_valid,
           avg(p.trunk_tilt_avg) AS trunk_tilt_avg, max(p.trunk_tilt_max) AS trunk_tilt_max,
           avg(p.l_knee) AS l_knee, avg(p.r_knee) AS r_knee, avg(p.l_hip) AS l_hip, avg(p.r_hip) AS r_hip,
           avg(p.l_elbow) AS l_elbow, avg(p.r_elbow) AS r_elbow, avg(p.l_shoulder) AS l_shoulder,
           avg(p.r_shoulder) AS r_shoulder, avg(p.balance_avg) AS balance_avg, min(p.balance_min) AS balance_min,
           max(p.com_offset_max) AS com_offset_max, avg(p.sway_avg) AS sway_avg, max(p.sway_max) AS sway_max
    FROM pose_1s p
    WHERE p.video_id = %(video_id)s AND p.bucket >= %(start)s AND p.bucket < %(finish)s
    GROUP BY b, p.person_idx"""

_SERIES_FROM_FRAMES = """
    SELECT time_bucket_gapfill(%(width)s::interval, f.ts, %(start)s::timestamptz, %(finish)s::timestamptz) AS b,
           f.person_idx, count(*) FILTER (WHERE f.valid) AS n_valid,
           avg(f.trunk_tilt) FILTER (WHERE f.valid) AS trunk_tilt_avg,
           max(f.trunk_tilt) FILTER (WHERE f.valid) AS trunk_tilt_max,
           avg(f.l_knee) FILTER (WHERE f.valid) AS l_knee, avg(f.r_knee) FILTER (WHERE f.valid) AS r_knee,
           avg(f.l_hip) FILTER (WHERE f.valid) AS l_hip, avg(f.r_hip) FILTER (WHERE f.valid) AS r_hip,
           avg(f.l_elbow) FILTER (WHERE f.valid) AS l_elbow, avg(f.r_elbow) FILTER (WHERE f.valid) AS r_elbow,
           avg(f.l_shoulder) FILTER (WHERE f.valid) AS l_shoulder,
           avg(f.r_shoulder) FILTER (WHERE f.valid) AS r_shoulder,
           avg(f.balance_score) FILTER (WHERE f.valid) AS balance_avg,
           min(f.balance_score) FILTER (WHERE f.valid) AS balance_min,
           max(abs(f.com_offset)) FILTER (WHERE f.valid) AS com_offset_max,
           avg(f.sway_velocity) FILTER (WHERE f.valid) AS sway_avg,
           max(f.sway_velocity) FILTER (WHERE f.valid) AS sway_max
    FROM pose_frames f
    WHERE f.video_id = %(video_id)s AND f.ts >= %(start)s AND f.ts < %(finish)s
    GROUP BY b, f.person_idx"""


@router.get("/videos/{video_id}/series")
def series(video_id: str, bucket_s: float = Query(1.0, gt=0, le=600)):
    """Per-person readings in buckets of bucket_s seconds of video time, gap-filled so a
    bucket where a person is not seen comes back with null readings. Buckets of a second
    or more roll up the pose_1s continuous aggregate; finer ones read pose_frames.
    t_offset is the bucket's centre in video seconds (buckets align to whole wall-clock
    seconds, so the first one can start up to a bucket before the video does)."""
    video = _video_or_404(video_id)
    start = video["recorded_at"]
    finish = start + dt.timedelta(seconds=float(video["duration_s"] or 0) + 1)
    source = _SERIES_FROM_ROLLUP if bucket_s >= 1 else _SERIES_FROM_FRAMES
    rows = db.fetch_all(
        f"""WITH s AS ({source})
            SELECT s.person_idx, coalesce(t.role, 'unknown') AS role,
                   greatest(0, extract(epoch FROM s.b - %(start)s::timestamptz)::float + %(half)s) AS t_offset, s.*
            FROM s LEFT JOIN pose_tracks t ON t.video_id = %(video_id)s AND t.person_idx = s.person_idx
            ORDER BY s.person_idx, s.b""",
        {"video_id": video["id"], "width": dt.timedelta(seconds=bucket_s), "half": bucket_s / 2,
         "start": start, "finish": finish},
    )
    for r in rows:
        r.pop("b", None)
    return {"video_id": video["id"], "bucket_s": bucket_s, "duration_s": video["duration_s"],
            "source": "pose_1s" if bucket_s >= 1 else "pose_frames", "rows": _rounded(rows)}


@router.get("/videos/{video_id}/frames")
def frames(video_id: str, metrics: str = Query("l_knee,r_knee"), points: int = Query(600, ge=10, le=5000)):
    """Per-frame readings for each person, downsampled to at most `points` per series with
    the toolkit's lttb (largest triangle three buckets), which keeps peaks and dips.
    A null is inserted wherever a person goes unseen, so charts break the line there."""
    video = _video_or_404(video_id)
    wanted = [m for m in metrics.split(",") if m in FRAME_METRICS]
    if not wanted:
        raise HTTPException(400, f"metrics must be some of: {', '.join(FRAME_METRICS)}")
    roles = {t["person_idx"]: t["role"] for t in repo.get_tracks(video["id"])}
    gap = max(1.0, 3 * float(video["duration_s"] or 0) / points)
    out = []
    for metric in wanted:  # metric is one of FRAME_METRICS, so it is safe to place in the SQL
        rows = db.fetch_all(
            f"""SELECT d.person_idx, extract(epoch FROM p.time - %(start)s::timestamptz)::float AS t, p.value AS v
                FROM (SELECT person_idx, lttb(ts, {metric}, %(points)s) AS tv FROM pose_frames
                      WHERE video_id = %(video_id)s AND valid AND {metric} IS NOT NULL
                      GROUP BY person_idx) d,
                     unnest(d.tv) p
                ORDER BY d.person_idx, p.time""",
            {"video_id": video["id"], "start": video["recorded_at"], "points": points},
        )
        by_person: dict[int, dict] = {}
        for r in rows:
            s = by_person.setdefault(r["person_idx"], {"metric": metric, "person_idx": r["person_idx"],
                                                       "role": roles.get(r["person_idx"], "unknown"), "t": [], "v": []})
            if s["t"] and r["t"] - s["t"][-1] > gap:
                s["t"].append(round(s["t"][-1] + gap / 2, 3))
                s["v"].append(None)
            s["t"].append(round(r["t"], 3))
            s["v"].append(round(r["v"], 2))
        out += by_person.values()
    return {"video_id": video["id"], "points": points, "series": out}


@router.get("/videos/{video_id}/summary")
def summary(video_id: str):
    """Tracks with roles and per-track statistics, the stored safety flags (pose flags were
    already named by role with pose.relabel_flags), how densely the video was measured, and
    the thresholds in use. A track's balance figures are shares of its standing_s and are
    None when it stood for less than THRESHOLDS["min_standing_s"]."""
    video = _video_or_404(video_id)
    attempt = db.fetch_one(
        """SELECT a.id, a.caregiver_name, coalesce(a.nurse_status, a.status) AS status, a.score_pct,
                  s.name AS skill_name, s.slug AS skill_slug
           FROM attempts a JOIN skills s ON s.id = a.skill_id WHERE a.video_id = %s""", (video["id"],))
    skill = attempt or db.fetch_one(
        "SELECT name AS skill_name, slug AS skill_slug FROM skills WHERE reference_video_id=%s ORDER BY version DESC LIMIT 1",
        (video["id"],))
    tracks = db.fetch_all(
        """SELECT t.person_idx, t.segment_id, t.role, t.first_t, t.last_t, t.n_frames, t.mean_visibility,
                  count(*) FILTER (WHERE f.valid)::float / nullif(count(*), 0) AS valid_share,
                  avg(f.balance_score) FILTER (WHERE f.valid) AS balance_avg,
                  min(f.balance_score) FILTER (WHERE f.valid) AS balance_min,
                  count(f.com_offset) FILTER (WHERE f.valid) AS balance_frames,
                  (count(*) FILTER (WHERE f.valid AND abs(f.com_offset) > %(off)s))::float
                    / nullif(count(f.com_offset) FILTER (WHERE f.valid), 0) AS off_center_share,
                  average(stats_agg(f.trunk_tilt) FILTER (WHERE f.valid)) AS tilt_avg,
                  stddev(stats_agg(f.trunk_tilt) FILTER (WHERE f.valid)) AS tilt_sd,
                  approx_percentile(0.95, percentile_agg(f.trunk_tilt) FILTER (WHERE f.valid)) AS tilt_p95,
                  (count(*) FILTER (WHERE f.valid AND f.trunk_tilt > %(bent)s))::float
                    / nullif(count(f.trunk_tilt) FILTER (WHERE f.valid), 0) AS bent_share,
                  least(min(f.l_knee) FILTER (WHERE f.valid), min(f.r_knee) FILTER (WHERE f.valid)) AS knee_min,
                  avg(f.sway_velocity) FILTER (WHERE f.valid) AS sway_avg
           FROM pose_tracks t JOIN pose_frames f ON f.video_id = t.video_id AND f.person_idx = t.person_idx
           WHERE t.video_id = %(video_id)s
           GROUP BY t.person_idx, t.segment_id, t.role, t.first_t, t.last_t, t.n_frames, t.mean_visibility
           ORDER BY t.person_idx""",
        {**_PARAMS, "video_id": video["id"]},
    )
    if attempt:
        flags = db.fetch_all("SELECT * FROM safety_flags WHERE attempt_id=%s ORDER BY start_s", (attempt["id"],))
    else:
        flags = db.fetch_all("SELECT * FROM safety_flags WHERE video_id=%s ORDER BY start_s", (video["id"],))
    rate = db.fetch_one(_SAMPLE_RATE.format(where="WHERE video_id = %(video_id)s"), {"video_id": video["id"]})
    sampling = _sampling(rate["sample_fps"] if rate else None, video["fps"])
    for t in tracks:
        fps = sampling["sample_fps"]
        t["standing_s"] = t["balance_frames"] / fps if fps else None
        if not (t["standing_s"] and t["standing_s"] >= THRESHOLDS["min_standing_s"]):
            t["balance_avg"] = t["balance_min"] = t["off_center_share"] = None
    return {"video": {k: video[k] for k in ("id", "kind", "original_name", "duration_s", "width", "height",
                                           "recorded_at")},
            "attempt": attempt, "skill": skill, "segments": len({t["segment_id"] for t in tracks}),
            "sampling": _rounded([sampling])[0], "tracks": _rounded(tracks), "flags": flags,
            "thresholds": THRESHOLDS}


@router.get("/trends")
def trends(bucket: str = Query("1 day", pattern=r"^\d+ (hour|hours|day|days|week|weeks)$")):
    """Per-role readings across attempts over calendar time, grouped by skill: one point per
    attempt, and one row per skill per time_bucket of the attempts' recording times that
    averages the attempts in it (so a long attempt counts once, like a short one).
    Attempts rejected as the wrong skill (skill_match false) are left out."""
    attempts = db.fetch_all(
        f"""WITH rate AS ({_ALL_SAMPLE_RATES})
            SELECT a.id AS attempt_id, v.recorded_at, time_bucket(%(bucket)s::interval, v.recorded_at) AS bucket,
                   a.caregiver_name, coalesce(a.nurse_status, a.status) AS status, a.score_pct,
                   s.slug AS skill_slug, s.name AS skill_name, q.sample_fps, {_ROLE_COUNTS}
            FROM pose_frames f
            JOIN attempts a ON a.video_id = f.video_id JOIN skills s ON s.id = a.skill_id
            JOIN videos v ON v.id = f.video_id
            LEFT JOIN rate q ON q.video_id = f.video_id
            LEFT JOIN pose_tracks t ON t.video_id = f.video_id AND t.person_idx = f.person_idx
            WHERE a.skill_match IS NOT FALSE
            GROUP BY a.id, v.recorded_at, s.slug, s.name, q.sample_fps ORDER BY v.recorded_at""",
        {**_PARAMS, "bucket": bucket},
    )
    groups: dict[tuple, list[dict]] = {}
    for a in attempts:
        _role_figures(a)
        groups.setdefault((a.pop("bucket"), a["skill_slug"]), []).append(a)

    def mean(items: list[dict], key: str) -> float | None:
        values = [i[key] for i in items if i[key] is not None]
        return sum(values) / len(values) if values else None

    buckets = [{"bucket": b, "skill_slug": slug, "skill_name": items[0]["skill_name"], "attempts": len(items),
                "patient_attempts": sum(1 for i in items if i["patient_off_center_share"] is not None),
                "patient_standing_s": sum(i["patient_standing_s"] or 0 for i in items),
                **{k: mean(items, k) for k in ("patient_balance_avg", "patient_balance_min", "patient_off_center_share",
                                               "caregiver_tilt_avg", "caregiver_tilt_peak", "caregiver_bent_share")}}
               for (b, slug), items in sorted(groups.items(), key=lambda g: (g[0][0], g[0][1]))]
    return {"bucket": bucket, "attempts": _rounded(attempts), "buckets": _rounded(buckets)}


@router.get("/storage")
def storage():
    """Facts about the pose_frames hypertable and its rollup for the "Stored in Tiger Data" panel.
    Each part is read independently so one unavailable catalogue view does not hide the rest."""
    def one(sql: str, params=None):
        try:
            return db.fetch_one(sql, params)
        except Exception as exc:  # a catalogue view differs between TimescaleDB versions
            return {"error": str(exc).splitlines()[0]}

    def many(sql: str, params=None):
        try:
            return db.fetch_all(sql, params)
        except Exception as exc:
            return [{"error": str(exc).splitlines()[0]}]

    return {
        "database": one("SELECT current_database() AS name, "
                        "(SELECT extversion FROM pg_extension WHERE extname='timescaledb') AS timescaledb, "
                        "(SELECT extversion FROM pg_extension WHERE extname='timescaledb_toolkit') AS toolkit"),
        "rows": one("SELECT count(*) AS pose_frames, count(DISTINCT video_id) AS videos, min(ts) AS first_ts, "
                    "max(ts) AS last_ts FROM pose_frames"),
        "hypertable": one("SELECT hypertable_name, num_chunks, compression_enabled AS columnstore_enabled "
                          "FROM timescaledb_information.hypertables WHERE hypertable_name='pose_frames'"),
        "size": one("SELECT table_bytes, index_bytes, toast_bytes, total_bytes, pg_size_pretty(total_bytes) AS total "
                    "FROM hypertable_detailed_size('pose_frames')"),
        "columnstore": one("SELECT segmentby, orderby FROM timescaledb_information.hypertable_columnstore_settings "
                           "WHERE hypertable::text = 'pose_frames'"),
        "chunks": many("SELECT chunk_name, range_start, range_end, is_compressed AS in_columnstore "
                       "FROM timescaledb_information.chunks WHERE hypertable_name='pose_frames' ORDER BY range_start"),
        "rollup": one(
            """SELECT c.view_name, c.materialized_only,
                      (SELECT count(*) FROM pose_1s) AS rows,
                      _timescaledb_functions.to_timestamp(_timescaledb_functions.cagg_watermark(h.id)) AS watermark
               FROM timescaledb_information.continuous_aggregates c
               JOIN _timescaledb_catalog.hypertable h ON h.table_name = c.materialization_hypertable_name
               WHERE c.view_name = 'pose_1s'"""),
        "jobs": many(
            """SELECT j.job_id, j.application_name, j.schedule_interval, j.config,
                      s.last_run_status, nullif(s.last_successful_finish, '-infinity') AS last_successful_finish,
                      nullif(s.next_start, '-infinity') AS next_start, s.total_runs
               FROM timescaledb_information.jobs j
               LEFT JOIN timescaledb_information.job_stats s ON s.job_id = j.job_id
               WHERE j.hypertable_name IN ('pose_frames', 'pose_1s')
                  OR j.proc_name IN ('policy_compression', 'policy_refresh_continuous_aggregate')
               ORDER BY j.job_id"""),
    }


