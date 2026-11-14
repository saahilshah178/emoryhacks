"use client";

import { Card, CardBody, CardHeader, CardTitle, EmptyState, Loadable, Skeleton } from "@/components/ui";
import { percent, plural } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { PoseTrends } from "@/lib/types";
import { LineChart } from "./LineChart";
import { balance100, deg, secs, type ChartSeries } from "./movement";

// Skill colours stay clear of the role colours (teal, navy, grey) used by the movement charts.
const SKILL_COLORS = ["#3979b9", "#b4690e", "#7c4dbd", "#0f6b45", "#c2410c", "#0e7490", "#a33b5b"];
const DAY_MS = 86_400_000;

// Buckets are calendar days in UTC, so they are labelled in UTC (not shifted to the day before).
function dayLabel(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function dayFull(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function TrendsPanel() {
  const { data, error, loading, reload } = useApi<PoseTrends>("/safety/trends");

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Trends by skill</CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">
            Caregiver attempts grouped by day. Each attempt counts once, however long it is; attempts rejected as the
            wrong skill are left out. Balance covers only time the patient was seen standing.
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <Loadable data={data} error={error} loading={loading} reload={reload} skeleton={<Skeleton className="h-56" />}>
          {(trends) => (trends.buckets.length === 0 ? <NoTrends /> : <Trends trends={trends} />)}
        </Loadable>
      </CardBody>
    </Card>
  );
}

function NoTrends() {
  return (
    <EmptyState title="No attempts with movement data yet">
      Trends appear once caregivers submit practice recordings and they are processed.
    </EmptyState>
  );
}

function Trends({ trends }: { trends: PoseTrends }) {
  const skills = [...new Map(trends.buckets.map((b) => [b.skill_slug, b.skill_name])).entries()];
  const colorOf = (slug: string) => SKILL_COLORS[skills.findIndex(([s]) => s === slug) % SKILL_COLORS.length];
  const days = [...new Set(trends.buckets.map((b) => new Date(b.bucket).getTime()))].sort((a, b) => a - b);
  const daysPerSkill = skills.map(([slug]) => new Set(trends.buckets.filter((b) => b.skill_slug === slug).map((b) => b.bucket)).size);
  const enough = Math.max(0, ...daysPerSkill) >= 2;

  const seriesFor = (key: "patient_balance_avg" | "caregiver_bent_share", scale: number): ChartSeries[] =>
    skills.map(([slug, name]) => ({
      id: slug,
      label: name,
      color: colorOf(slug),
      points: trends.buckets
        .filter((b) => b.skill_slug === slug)
        .map((b) => ({ t: new Date(b.bucket).getTime(), v: b[key] === null ? null : (b[key] as number) * scale }))
        .sort((a, b) => a.t - b.t),
    }));

  const domain: [number, number] = [days[0] - DAY_MS / 2, days[days.length - 1] + DAY_MS / 2];
  const ticks = days.length <= 8 ? days : days.filter((_, i) => i % Math.ceil(days.length / 8) === 0);

  return (
    <div className="space-y-5">
      {enough ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Patient balance while standing, daily average</p>
            <LineChart
              label="Patient balance while standing, daily average per skill, out of 100."
              series={seriesFor("patient_balance_avg", 100)}
              xDomain={domain}
              xTicks={ticks}
              formatX={dayLabel}
              xLabel="Day"
              yDomain={[0, 100]}
              yTicks={[0, 25, 50, 75, 100]}
              yLabel="Balance, 0–100"
              showPoints
              height={190}
              empty="No attempt showed the patient standing with both feet in view."
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Caregiver time bent past 60°, daily share</p>
            <LineChart
              label="Share of the time the caregiver was bent past 60 degrees, daily per skill."
              series={seriesFor("caregiver_bent_share", 100)}
              xDomain={domain}
              xTicks={ticks}
              formatX={dayLabel}
              xLabel="Day"
              yDomain={[0, 100]}
              yTicks={[0, 25, 50, 75, 100]}
              formatY={(v) => `${v}%`}
              yLabel="Share of tracked time"
              showPoints
              height={190}
              empty="No caregiver was tracked in these attempts."
            />
          </div>
        </div>
      ) : (
        <p className="rounded-[12px] bg-page px-4 py-3 text-sm text-ink-secondary">
          A trend line needs readings from at least two days for the same skill. Until then, here is each day&apos;s
          figure.
        </p>
      )}

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs text-ink-secondary">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">Day</th>
              <th className="py-2 pr-3 font-medium">Skill</th>
              <th className="py-2 pr-3 font-medium">Attempts</th>
              <th className="py-2 pr-3 font-medium">Patient balance, lowest / average</th>
              <th className="py-2 pr-3 font-medium">Patient off-centre</th>
              <th className="py-2 pr-3 font-medium">Caregiver lean, average / peak</th>
              <th className="py-2 font-medium">Caregiver bent past 60°</th>
            </tr>
          </thead>
          <tbody>
            {trends.buckets.map((b) => (
              <tr key={`${b.bucket}-${b.skill_slug}`} className="border-b border-border last:border-0">
                <td className="py-2.5 pr-3">{dayFull(b.bucket)}</td>
                <td className="py-2.5 pr-3">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(b.skill_slug) }} aria-hidden />
                    {b.skill_name}
                  </span>
                </td>
                <td className="py-2.5 pr-3 tabular-nums">{b.attempts}</td>
                <td className="py-2.5 pr-3 tabular-nums">
                  {b.patient_attempts && b.patient_balance_avg !== null ? (
                    <>
                      {balance100(b.patient_balance_min)} / {balance100(b.patient_balance_avg)}
                      <span className="block text-xs text-ink-secondary">
                        {plural(b.patient_attempts, "attempt")}, {secs(b.patient_standing_s)} standing
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-ink-secondary">patient not seen standing</span>
                  )}
                </td>
                <td className="py-2.5 pr-3 tabular-nums">
                  {b.patient_off_center_share !== null ? (
                    percent(b.patient_off_center_share)
                  ) : (
                    <span className="text-xs text-ink-secondary">patient not seen standing</span>
                  )}
                </td>
                <td className="py-2.5 pr-3 tabular-nums">
                  {b.caregiver_tilt_avg !== null ? (
                    `${deg(b.caregiver_tilt_avg)} / ${deg(b.caregiver_tilt_peak)}`
                  ) : (
                    <span className="text-xs text-ink-secondary">no caregiver tracked</span>
                  )}
                </td>
                <td className="py-2.5 tabular-nums">
                  {b.caregiver_bent_share !== null ? (
                    percent(b.caregiver_bent_share)
                  ) : (
                    <span className="text-xs text-ink-secondary">no caregiver tracked</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
