"use client";

import { TimeChip } from "@/components/media/TimeChip";
import { formatRange, percent } from "@/lib/format";
import { personRole } from "@/lib/status";
import type { PoseSummary, PoseTrack } from "@/lib/types";
import { balance100, deg, ROLE_COLOR, ROLE_ORDER, secs } from "./movement";

function sorted(tracks: PoseTrack[]) {
  return [...tracks].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.person_idx - b.person_idx || a.segment_id - b.segment_id,
  );
}

function names(tracks: PoseTrack[]) {
  const counts = new Map<string, number>();
  for (const t of tracks) counts.set(t.role, (counts.get(t.role) ?? 0) + 1);
  return (t: PoseTrack) => ((counts.get(t.role) ?? 0) > 1 ? `${personRole[t.role]} (track ${t.person_idx + 1})` : personRole[t.role]);
}

export function RoleDot({ role }: { role: PoseTrack["role"] }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ROLE_COLOR[role] }} aria-hidden />;
}

/** Each tracked person's measured figures in plain words (review page). */
export function TrackFigures({ summary }: { summary: PoseSummary }) {
  const tracks = sorted(summary.tracks);
  const nameOf = names(tracks);
  const minStanding = summary.thresholds.min_standing_s;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {tracks.map((t) => {
        const standing = t.standing_s !== null && t.standing_s >= minStanding;
        const rows: Array<[string, string]> = [
          ["Tracked", `${secs(Math.max(0, t.last_t - t.first_t))} (${formatRange(t.first_t, t.last_t)})`],
          ["Standing", standing ? secs(t.standing_s) : "Not seen standing with both feet in view"],
          [
            "Balance",
            t.balance_min !== null
              ? `Lowest ${balance100(t.balance_min)} / 100, average ${balance100(t.balance_avg)}`
              : "Not measured: balance is read only while a person is standing",
          ],
          ["Off-centre", t.off_center_share !== null ? `${percent(t.off_center_share)} of standing time` : "Not measured (not seen standing)"],
          ["Peak lean", t.tilt_p95 !== null ? `${deg(t.tilt_p95)} from upright (95th percentile)` : "Trunk not in view"],
          ["Bent past 60°", t.bent_share !== null ? `${percent(t.bent_share)} of the time` : "Trunk not in view"],
          ["Deepest knee bend", t.knee_min !== null ? `${deg(t.knee_min)} (180° is a straight leg)` : "Knees not in view"],
        ];
        return (
          <li key={`${t.person_idx}-${t.segment_id}`} className="rounded-[12px] border border-border bg-white p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <RoleDot role={t.role} />
              {nameOf(t)}
            </p>
            <dl className="mt-2 space-y-1 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <dt className="w-36 shrink-0 text-ink-secondary">{label}</dt>
                  <dd className="min-w-0 text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

/** Every track as a table row (movement detail page). */
export function TrackTable({ summary, onPlay }: { summary: PoseSummary; onPlay?: (start: number, end?: number | null) => void }) {
  const tracks = sorted(summary.tracks);
  const nameOf = names(tracks);
  const minStanding = summary.thresholds.min_standing_s;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-xs text-ink-secondary">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">Person</th>
            <th className="py-2 pr-3 font-medium">Seen</th>
            <th className="py-2 pr-3 font-medium" title="Time seen standing with both feet in view; balance is measured only then">
              Standing
            </th>
            <th className="py-2 pr-3 font-medium">Balance, lowest / average</th>
            <th className="py-2 pr-3 font-medium">Off-centre</th>
            <th className="py-2 pr-3 font-medium">Lean, average / peak</th>
            <th className="py-2 pr-3 font-medium">Bent past 60°</th>
            <th className="py-2 font-medium">Deepest knee bend</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((t) => {
            const standing = t.standing_s !== null && t.standing_s >= minStanding;
            return (
              <tr key={`${t.person_idx}-${t.segment_id}`} className="border-b border-border last:border-0">
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <RoleDot role={t.role} />
                    {nameOf(t)}
                  </span>
                </td>
                <td className="whitespace-nowrap py-2.5 pr-3">
                  <TimeChip start={t.first_t} end={t.last_t} onPlay={onPlay} />
                </td>
                <td className="py-2.5 pr-3 tabular-nums">{standing ? secs(t.standing_s) : <Muted>not seen standing</Muted>}</td>
                <td className="py-2.5 pr-3 tabular-nums">
                  {t.balance_min !== null ? `${balance100(t.balance_min)} / ${balance100(t.balance_avg)}` : <Muted>not seen standing</Muted>}
                </td>
                <td className="py-2.5 pr-3 tabular-nums">
                  {t.off_center_share !== null ? percent(t.off_center_share) : <Muted>not seen standing</Muted>}
                </td>
                <td className="py-2.5 pr-3 tabular-nums">
                  {t.tilt_avg !== null ? `${deg(t.tilt_avg)} / ${deg(t.tilt_p95)}` : <Muted>trunk not in view</Muted>}
                </td>
                <td className="py-2.5 pr-3 tabular-nums">{t.bent_share !== null ? percent(t.bent_share) : <Muted>–</Muted>}</td>
                <td className="py-2.5 tabular-nums">{t.knee_min !== null ? deg(t.knee_min) : <Muted>knees not in view</Muted>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Muted({ children }: { children: string }) {
  return <span className="text-xs text-ink-secondary">{children}</span>;
}
