"use client";

import { formatClock } from "@/lib/format";
import { personRole } from "@/lib/status";
import type { PoseSummary } from "@/lib/types";
import { LineChart } from "./LineChart";
import { flagWindows, type ChartSeries } from "./movement";

type Common = {
  series: ChartSeries[];
  summary: PoseSummary;
  duration: number;
  /** Where the video is now; null hides the playhead (no video to follow). */
  playhead?: number | null;
  /** Clicking the chart moves the video here. Omit when there is no video to move. */
  onSeek?: (seconds: number) => void;
  height?: number;
  /** Replaces the default note shown when there is nothing to draw. */
  empty?: string;
};

function who(series: ChartSeries[]) {
  const roles = [...new Set(series.map((s) => (s.role ? personRole[s.role].toLowerCase() : "person")))];
  return roles.length ? roles.join(" and ") : "nobody";
}

function range(series: ChartSeries[]) {
  const values = series.flatMap((s) => s.points.map((p) => p.v)).filter((v): v is number => v !== null);
  if (!values.length) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Balance while standing, 0–100 (100 = weight centred over the feet). Series values already 0–100. */
export function BalanceChart({ series, summary, duration, playhead, onSeek, height }: Common) {
  const low = Math.round(summary.thresholds.balance_low * 100);
  const span = range(series);
  return (
    <LineChart
      label={
        span
          ? `Balance over video time for the ${who(series)}, from ${Math.round(span.min)} to ${Math.round(span.max)} out of 100. Readings below ${low} are shaded as low balance.`
          : "No balance readings for this video."
      }
      series={series}
      xDomain={[0, duration]}
      formatX={formatClock}
      xLabel="Video time (min:sec)"
      yDomain={[0, 100]}
      yTicks={[0, 25, 50, 75, 100]}
      yLabel="Balance, 0–100 (100 = centred over the feet)"
      bands={[{ from: 0, to: low, label: `Low balance (below ${low})`, tone: "danger" }]}
      shades={flagWindows(summary, ["patient_off_center", "patient_unsteady"])}
      shadeLabel="Patient flag"
      playhead={playhead}
      onSeek={onSeek}
      height={height}
      empty="Nobody was seen standing with both feet in view, so there is no balance reading. Balance is measured only while a person is standing."
    />
  );
}

/** Trunk lean in degrees from upright, with the caution and bent-over bands. */
export function LeanChart({ series, summary, duration, playhead, onSeek, height, empty }: Common) {
  const th = summary.thresholds;
  const span = range(series);
  return (
    <LineChart
      label={
        span
          ? `Trunk lean over video time for the ${who(series)}, from ${Math.round(span.min)} to ${Math.round(span.max)} degrees from upright. ${th.tilt_caution} to ${th.tilt_bent} degrees is shaded as caution, above ${th.tilt_bent} as bent over.`
          : "No trunk lean readings for this video."
      }
      series={series}
      xDomain={[0, duration]}
      formatX={formatClock}
      xLabel="Video time (min:sec)"
      yDomain={[0, 90]}
      yTicks={[0, 30, 60, 90]}
      formatY={(v) => `${v}°`}
      yLabel="Trunk lean, degrees from upright"
      bands={[
        { from: th.tilt_caution, to: th.tilt_bent, label: `Caution (${th.tilt_caution}–${th.tilt_bent}°)`, tone: "warning" },
        { from: th.tilt_bent, to: 90, label: `Bent over (over ${th.tilt_bent}°)`, tone: "danger" },
      ]}
      shades={flagWindows(summary, ["unsafe_caregiver_posture"])}
      shadeLabel="Posture flag"
      playhead={playhead}
      onSeek={onSeek}
      height={height}
      empty={empty ?? "No trunk readings in this video: nobody\u2019s trunk was in view."}
    />
  );
}

/** Knee angles, solid left and dashed right; 180° is a straight leg. */
export function KneeChart({ series, duration, playhead, onSeek, height }: Omit<Common, "summary">) {
  const span = range(series);
  return (
    <LineChart
      label={
        span
          ? `Knee angles over video time for the ${who(series)}, from ${Math.round(span.min)} to ${Math.round(span.max)} degrees; 180 degrees is a straight leg. Left knees solid, right knees dashed.`
          : "No knee readings for this video."
      }
      series={series}
      xDomain={[0, duration]}
      formatX={formatClock}
      xLabel="Video time (min:sec)"
      yDomain={[0, 180]}
      yTicks={[0, 45, 90, 135, 180]}
      formatY={(v) => `${v}°`}
      yLabel="Knee angle, degrees (180 = straight)"
      playhead={playhead}
      onSeek={onSeek}
      height={height}
      empty="No knee readings: the legs were not in view."
    />
  );
}
