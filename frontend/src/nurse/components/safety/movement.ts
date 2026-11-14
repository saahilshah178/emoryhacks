// Shared wording, colours and data shaping for the movement (pose) screens.
import { personRole } from "@/lib/status";
import type { PoseBucket, PoseFrames, PoseSummary, TrackRole } from "@/lib/types";

/** One colour per role, used by every chart, legend and table. */
export const ROLE_COLOR: Record<TrackRole, string> = {
  caregiver: "var(--teal)",
  patient: "var(--navy)",
  other: "#94a3b0",
  unknown: "#94a3b0",
};

export const ROLE_ORDER: TrackRole[] = ["patient", "caregiver", "other", "unknown"];

/** "0.4 s", "14 s", "2 min 5 s". Null reads "–". */
export function secs(value: number | null | undefined) {
  if (value === null || value === undefined) return "–";
  if (value < 10) return `${Number(value).toFixed(1).replace(/\.0$/, "")} s`;
  const whole = Math.round(value);
  if (whole < 60) return `${whole} s`;
  return `${Math.floor(whole / 60)} min${whole % 60 ? ` ${whole % 60} s` : ""}`;
}

/** 31.9 -> "32°" */
export function deg(value: number | null | undefined) {
  return value === null || value === undefined ? "–" : `${Math.round(value)}°`;
}

/** A balance reading (0..1) shown out of 100. */
export function balance100(value: number | null | undefined) {
  return value === null || value === undefined ? "–" : String(Math.round(value * 100));
}

/** How densely a video was measured: "every frame (24 per second)" or "5 frames per second of 24". */
export function samplingText(sampling: { sample_fps: number | null; video_fps: number | null; every_frame: boolean } | null | undefined) {
  if (!sampling?.sample_fps) return "";
  if (sampling.every_frame) return `every frame (${Math.round(sampling.sample_fps)} per second)`;
  const rate = Number(sampling.sample_fps.toFixed(1));
  return `${rate} ${rate === 1 ? "frame" : "frames"} per second${sampling.video_fps ? ` of ${Math.round(sampling.video_fps)}` : ""}`;
}

export type ChartPoint = { t: number; v: number | null };
export type ChartSeries = {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  role?: TrackRole;
  points: ChartPoint[];
};

/** Label for one tracked person; a number is added only when two people share a role. */
function personLabel(role: TrackRole, idx: number, sameRole: number) {
  return sameRole > 1 ? `${personRole[role]} (track ${idx + 1})` : personRole[role];
}

/**
 * One series per person from gap-filled buckets. A null (person not seen, or no reading
 * of this kind) breaks the line. People with no value at all are left out.
 */
export function seriesFromBuckets(
  rows: PoseBucket[],
  key: keyof PoseBucket,
  options: { roles?: TrackRole[]; scale?: number } = {},
): ChartSeries[] {
  const scale = options.scale ?? 1;
  const people = new Map<number, { role: TrackRole; points: ChartPoint[] }>();
  for (const row of rows) {
    if (options.roles && !options.roles.includes(row.role)) continue;
    let person = people.get(row.person_idx);
    if (!person) {
      person = { role: row.role, points: [] };
      people.set(row.person_idx, person);
    }
    const raw = row[key];
    person.points.push({ t: row.t_offset, v: typeof raw === "number" ? raw * scale : null });
  }
  return finish([...people.entries()].map(([idx, p]) => ({ idx, role: p.role, points: p.points.sort((a, b) => a.t - b.t) })));
}

/** One series per person and metric from /frames. Right-side metrics are dashed. */
export function seriesFromFrames(frames: PoseFrames, metrics: string[]): ChartSeries[] {
  const wanted = frames.series.filter((s) => metrics.includes(s.metric));
  const roleCounts = countRoles(wanted.map((s) => ({ idx: s.person_idx, role: s.role })));
  return wanted
    .filter((s) => s.v.some((v) => v !== null))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.person_idx - b.person_idx)
    .map((s) => {
      const side = s.metric.startsWith("l_") ? "left" : s.metric.startsWith("r_") ? "right" : "";
      const who = personLabel(s.role, s.person_idx, roleCounts.get(s.role) ?? 1);
      return {
        id: `${s.metric}-${s.person_idx}`,
        label: side ? `${who}, ${side}` : who,
        color: ROLE_COLOR[s.role],
        dashed: side === "right",
        role: s.role,
        points: s.t.map((t, i) => ({ t, v: s.v[i] })),
      };
    });
}

function countRoles(people: Array<{ idx: number; role: TrackRole }>) {
  const seen = new Map<number, TrackRole>();
  for (const p of people) seen.set(p.idx, p.role);
  const counts = new Map<TrackRole, number>();
  for (const role of seen.values()) counts.set(role, (counts.get(role) ?? 0) + 1);
  return counts;
}

function finish(people: Array<{ idx: number; role: TrackRole; points: ChartPoint[] }>): ChartSeries[] {
  const kept = people.filter((p) => p.points.some((point) => point.v !== null));
  const counts = countRoles(kept);
  return kept
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.idx - b.idx)
    .map((p) => ({
      id: `p${p.idx}`,
      label: personLabel(p.role, p.idx, counts.get(p.role) ?? 1),
      color: ROLE_COLOR[p.role],
      role: p.role,
      points: p.points,
    }));
}

/** Flags of these kinds, as shaded stretches on a chart. */
export function flagWindows(summary: PoseSummary | undefined, kinds: string[]) {
  return (summary?.flags ?? [])
    .filter((flag) => kinds.includes(flag.kind))
    .map((flag) => ({ start: flag.start_s, end: flag.end_s }));
}
