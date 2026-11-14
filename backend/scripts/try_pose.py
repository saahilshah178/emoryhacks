"""Run the pose stage on reference videos and print what it stored.

  uv run python -m scripts.try_pose "Fall Response Backup.mp4"
  uv run python -m scripts.try_pose "sittostand_primary.mp4" --at 5,25,45 --out /tmp/pose
  uv run python -m scripts.try_pose "Fall Response Backup.mp4" --roles      # real Gemini calls

--at draws landmarks, track ids and readings onto the frames nearest those times and
saves them as JPEGs in --out. --roles also runs assign_roles; the people descriptions
come from a stored skill for the video when there is one, else a generic pair.
A video already ingested under the same file name is reused.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from app import config, db, jobs, pose_math, repo
from app.models import PersonObs
from app.stages import pose

GENERIC_PEOPLE = [
    PersonObs(label="P1", role="caregiver", description="the person giving help"),
    PersonObs(label="P2", role="patient", description="the person being helped"),
]
COLOURS = [(0, 200, 0), (0, 0, 230), (230, 120, 0), (200, 0, 200), (0, 200, 200)]


def get_video(filename: str) -> dict:
    row = db.fetch_one("SELECT * FROM videos WHERE original_name=%s AND kind=%s ORDER BY recorded_at DESC LIMIT 1",
                       (filename, "reference"))
    if row and Path(row["path"]).exists():
        return row
    return jobs.ingest(str(config.REFERENCE_DIR / filename), "reference", filename)


def people_for(video_id) -> list[PersonObs]:
    skill = db.fetch_one("SELECT people FROM skills WHERE reference_video_id=%s ORDER BY version DESC LIMIT 1", (video_id,))
    return repo.people_from(skill["people"]) if skill and skill["people"] else GENERIC_PEOPLE


class Overlay:
    """Captures landmarks during extraction for the requested times and draws them afterwards."""

    def __init__(self, times: list[float]):
        self.times = sorted(times)
        self.shots: list[dict] = []
        self._calls: list[tuple] = []
        self._measure, self._readings = pose._measure, pose.pose_math.frame_readings

    def __enter__(self):
        def readings(xy, vis, world, aspect):
            self._calls.append((np.array(xy), np.array(vis)))
            return self._readings(xy, vis, world, aspect)

        def measure(detector, tracker, smooth, frame, t, segment):
            self._calls.clear()
            rows = self._measure(detector, tracker, smooth, frame, t, segment)
            if self.times and t >= self.times[0]:
                self.times.pop(0)
                self.shots.append({"t": t, "frame": frame.copy(), "people": list(zip(rows, self._calls))})
            return rows

        pose._measure, pose.pose_math.frame_readings = measure, readings
        return self

    def __exit__(self, *exc):
        pose._measure, pose.pose_math.frame_readings = self._measure, self._readings

    def save(self, video_id, out_dir: Path, stem: str) -> list[Path]:
        """Draw each captured frame, labelling people with their stored person_idx."""
        out_dir.mkdir(parents=True, exist_ok=True)
        paths = []
        for shot in self.shots:
            stored = db.fetch_all("SELECT person_idx, bbox_x0, bbox_y0 FROM pose_frames "
                                  "WHERE video_id=%s AND abs(t_offset - %s) < 0.01", (video_id, shot["t"]))
            img = cv2.resize(shot["frame"], None, fx=2, fy=2) if max(shot["frame"].shape[:2]) < 500 else shot["frame"].copy()
            h, w = img.shape[:2]
            for row, (xy, vis) in shot["people"]:
                match = next((s["person_idx"] for s in stored if abs(s["bbox_x0"] - row["bbox_x0"]) < 1e-4
                              and abs(s["bbox_y0"] - row["bbox_y0"]) < 1e-4), None)
                draw_person(img, w, h, xy, vis, row, match)
            cv2.putText(img, f"t={shot['t']:.1f}s", (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
            path = out_dir / f"{stem}_{shot['t']:05.1f}.jpg"
            cv2.imwrite(str(path), img)
            paths.append(path)
        return paths


def draw_person(img, w, h, xy, vis, row, person_idx) -> None:
    colour = COLOURS[(person_idx or 0) % len(COLOURS)] if person_idx is not None else (128, 128, 128)
    pt = lambda i: (int(xy[i][0] * w), int(xy[i][1] * h))  # noqa: E731
    for a, b in [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24), (23, 25), (25, 27),
                 (24, 26), (26, 28), (27, 29), (29, 31), (27, 31), (28, 30), (30, 32), (28, 32)]:
        if vis[a] > pose_math.VISIBLE and vis[b] > pose_math.VISIBLE:
            cv2.line(img, pt(a), pt(b), colour, 2)
    for i in range(33):
        if vis[i] > pose_math.VISIBLE:
            cv2.circle(img, pt(i), 3, colour, -1)
    if row.get("com_x") is not None:
        cv2.drawMarker(img, (int(row["com_x"] * w), int(row["com_y"] * h)), (0, 255, 255), cv2.MARKER_CROSS, 18, 2)
    if row.get("bos_center_x") is not None:
        y = int(max(xy[i][1] for i in (27, 28, 29, 30, 31, 32)) * h) + 6
        x0, x1 = (row["bos_center_x"] - row["bos_width"] / 2) * w, (row["bos_center_x"] + row["bos_width"] / 2) * w
        cv2.line(img, (int(x0), y), (int(x1), y), (0, 255, 255), 3)
    fmt = lambda v, d=0: "-" if v is None else f"{v:.{d}f}"  # noqa: E731
    lines = [f"#{person_idx if person_idx is not None else '?'} {'valid' if row['valid'] else 'INVALID'}",
             f"tilt {fmt(row.get('trunk_tilt'))} lat {fmt(row.get('trunk_lateral'))}",
             f"knee L{fmt(row.get('l_knee'))} R{fmt(row.get('r_knee'))} hip L{fmt(row.get('l_hip'))}",
             f"bal {fmt(row.get('balance_score'), 2)} off {fmt(row.get('com_offset'), 2)}"]
    x0, y0 = int(row["bbox_x0"] * w), max(20, int(row["bbox_y0"] * h) - 70)
    for k, text in enumerate(lines):
        cv2.putText(img, text, (x0, y0 + 17 * k), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(img, text, (x0, y0 + 17 * k), cv2.FONT_HERSHEY_SIMPLEX, 0.5, colour, 1)


def report(video_id) -> None:
    for t in db.fetch_all(
        """SELECT t.person_idx, t.segment_id, t.role, t.first_t, t.last_t, t.n_frames,
                  round(avg(f.trunk_tilt)::numeric, 1) AS tilt, round(avg(f.balance_score)::numeric, 2) AS balance,
                  round(avg(f.l_knee)::numeric, 0) AS l_knee, count(f.com_offset) AS n_balance,
                  round(min(f.t_offset) FILTER (WHERE f.com_offset IS NOT NULL)::numeric, 1) AS standing_from,
                  round(max(f.t_offset) FILTER (WHERE f.com_offset IS NOT NULL)::numeric, 1) AS standing_to,
                  round(avg(f.sway_velocity)::numeric, 2) AS sway
           FROM pose_tracks t JOIN pose_frames f ON f.video_id = t.video_id AND f.person_idx = t.person_idx AND f.valid
           WHERE t.video_id=%s GROUP BY 1,2,3,4,5,6 ORDER BY 1""", (video_id,)):
        span = f", {t['standing_from']}-{t['standing_to']}s" if t["n_balance"] else ""
        print(f"  track {t['person_idx']} seg {t['segment_id']} {t['role']:9s} {t['first_t']:6.1f}-{t['last_t']:6.1f}s "
              f"frames {t['n_frames']:4d}  tilt {t['tilt']}  balance {t['balance']} ({t['n_balance']} standing frames{span})  "
              f"l_knee {t['l_knee']}  sway {t['sway']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("videos", nargs="+", help="file names in reference_vids/")
    parser.add_argument("--at", default="", help="comma-separated times to draw")
    parser.add_argument("--out", default=str(config.TMP_DIR / "pose_overlays"))
    parser.add_argument("--roles", action="store_true", help="also run assign_roles (calls Gemini)")
    args = parser.parse_args()
    db.migrate()
    times = [float(x) for x in args.at.split(",") if x.strip()]
    for name in args.videos:
        video = get_video(name)
        ctx = jobs.StageContext(job_id=None, video=video)
        print(f"\n== {name}  ({video['duration_s']:.0f}s, {video['width']}x{video['height']})  video_id={video['id']}")
        with Overlay(times) as overlay:
            summary = pose.extract(ctx)
        print(f"  {summary.note}")
        print(f"  frames_written={summary.frames_written} tracks={summary.tracks} segments={summary.segments} "
              f"sample_fps={summary.sample_fps}")
        flags = summary.candidate_flags
        if args.roles:
            pose.assign_roles(ctx, people_for(video["id"]))
            flags = pose.relabel_flags(video["id"], flags)  # as the pipeline stores them
        report(video["id"])
        for f in flags:
            print(f"  flag {f.kind} {f.severity} {f.start_s:.1f}-{f.end_s:.1f}s {f.person_label}: {f.description}")
        for path in overlay.save(video["id"], Path(args.out), Path(name).stem.replace(" ", "_")):
            print(f"  saved {path}")


if __name__ == "__main__":
    main()
