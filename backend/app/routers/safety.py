"""Safety dashboard queries over the pose time series in Tiger Data.
Owned by branch feat/pose-tiger.

GET /api/safety/overview                 per-video rollup across all videos that have pose data
GET /api/safety/videos/{id}/series       one-second series per tracked person, from the pose_1s rollup
"""
from __future__ import annotations

from fastapi import APIRouter

from .. import db

router = APIRouter(prefix="/safety", tags=["safety"])


@router.get("/overview")
def overview():
    return db.fetch_all(
        """SELECT p.video_id, v.kind, v.original_name, v.duration_s,
                  count(*) AS seconds_tracked,
                  round(avg(p.balance_avg)::numeric, 3) AS balance_avg,
                  round(min(p.balance_min)::numeric, 3) AS balance_min,
                  round(max(p.trunk_tilt_max)::numeric, 1) AS trunk_tilt_max
           FROM pose_1s p JOIN videos v ON v.id = p.video_id
           GROUP BY p.video_id, v.kind, v.original_name, v.duration_s, v.recorded_at
           ORDER BY v.recorded_at DESC"""
    )


@router.get("/videos/{video_id}/series")
def series(video_id: str):
    rows = db.fetch_all(
        """SELECT p.person_idx, coalesce(t.role, 'unknown') AS role, p.t_offset, p.n_valid,
                  p.trunk_tilt_avg, p.trunk_tilt_max, p.l_knee, p.r_knee, p.l_hip, p.r_hip,
                  p.l_elbow, p.r_elbow, p.l_shoulder, p.r_shoulder,
                  p.balance_avg, p.balance_min, p.com_offset_max, p.sway_avg, p.sway_max
           FROM pose_1s p LEFT JOIN pose_tracks t ON t.video_id = p.video_id AND t.person_idx = p.person_idx
           WHERE p.video_id = %s ORDER BY p.person_idx, p.bucket""",
        (video_id,),
    )
    return {"video_id": video_id, "rows": rows}
