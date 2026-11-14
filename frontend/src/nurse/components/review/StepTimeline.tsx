"use client";

import { cn } from "@/lib/cn";
import { formatClock, formatRange } from "@/lib/format";
import { flagSeverity, flagTitle, stepStatus, toneSolid } from "@/lib/status";
import type { AttemptStep, SafetyFlag } from "@/lib/types";
import { effectiveStatus, locatedSteps, type Overrides } from "./steps";

const LANE_PX = 30;

/**
 * The attempt's steps on one bar over video time: a segment per located step coloured by
 * its status, safety flags as markers above, and the playhead when there is a video.
 */
export function StepTimeline({
  steps,
  overrides,
  flags,
  duration,
  activeId,
  playhead,
  onSelect,
  onPlayFlag,
}: {
  steps: AttemptStep[];
  overrides: Overrides;
  flags: SafetyFlag[];
  duration: number;
  activeId: string | null;
  /** Null when there is no video to follow. */
  playhead: number | null;
  onSelect: (step: AttemptStep) => void;
  /** Plays a flag's stretch; omitted when there is no video. */
  onPlayFlag?: (start: number, end?: number | null) => void;
}) {
  const total = Math.max(duration, 1);
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / total) * 100))}%`;

  // Greedy lanes, so overlapping steps sit on separate rows instead of hiding each other.
  const laneEnds: number[] = [];
  const segments = locatedSteps(steps).map(({ step, span }) => {
    let lane = laneEnds.findIndex((end) => end <= span.start + 0.05);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = span.end;
    return { step, span, lane };
  });
  const lanes = Math.max(1, laneEnds.length);
  const unlocated = steps.filter((s) => !segments.some((seg) => seg.step.step_id === s.step_id));
  const ticks = [0, total / 4, total / 2, (3 * total) / 4, total];

  return (
    <div>
      {/* flag markers */}
      <div className="relative h-5" aria-label="Safety flags on the timeline">
        {flags.map((flag) => {
          const entry = flagSeverity[flag.severity];
          const label = `${flagTitle(flag)} (${entry.label.toLowerCase()}), ${
            flag.end_s !== null ? formatRange(flag.start_s, flag.end_s) : formatClock(flag.start_s)
          }`;
          const shape = (
            <svg viewBox="0 0 10 9" className="h-3 w-3" aria-hidden>
              <path d="M5 0L10 9H0Z" className={cn(entry.tone === "danger" ? "fill-danger" : entry.tone === "warning" ? "fill-warning" : "fill-ink-secondary")} />
            </svg>
          );
          return onPlayFlag ? (
            <button
              key={flag.id}
              type="button"
              title={label}
              aria-label={`Play safety flag: ${label}`}
              onClick={() => onPlayFlag(flag.start_s, flag.end_s)}
              className="absolute top-1 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-sm hover:bg-secondary"
              style={{ left: pct(flag.start_s) }}
            >
              {shape}
            </button>
          ) : (
            <span
              key={flag.id}
              title={label}
              className="absolute top-1 flex h-4 w-4 -translate-x-1/2 items-center justify-center"
              style={{ left: pct(flag.start_s) }}
            >
              {shape}
              <span className="sr-only">Safety flag: {label}</span>
            </span>
          );
        })}
      </div>

      {/* step segments */}
      <div className="relative rounded-[10px] bg-secondary" style={{ height: lanes * LANE_PX + 6 }}>
        {segments.length === 0 ? (
          <p className="absolute left-3 top-1.5 text-xs text-ink-secondary">
            {steps.some((s) => s.found === false) ? "None of the steps were found in this recording." : "No steps located yet."}
          </p>
        ) : null}
        {segments.map(({ step, span, lane }) => {
          const status = effectiveStatus(step, overrides[step.step_id]);
          const entry = status ? stepStatus[status] : null;
          const active = step.step_id === activeId;
          return (
            <button
              key={step.step_id}
              type="button"
              onClick={() => onSelect(step)}
              aria-pressed={active}
              aria-label={`Step ${step.ord}, ${step.title}, ${formatRange(span.start, span.end)}, ${entry?.label ?? "not graded"}`}
              title={`${step.ord}. ${step.title} (${formatRange(span.start, span.end)})${span.byGrader ? " · placed by the grader's evidence" : ""}`}
              className={cn(
                "absolute flex items-center justify-center rounded-[6px] text-[11px] font-semibold text-white transition-shadow",
                entry ? toneSolid[entry.tone] : "bg-ink-secondary",
                span.byGrader && "opacity-75",
                active ? "z-10 ring-2 ring-navy ring-offset-2 ring-offset-secondary" : "hover:ring-2 hover:ring-white/70",
              )}
              style={{
                left: `calc(${pct(span.start)} + 1px)`,
                width: `max(18px, calc(${pct(span.end - span.start)} - 2px))`,
                top: 3 + lane * LANE_PX,
                height: LANE_PX - 6,
              }}
            >
              {step.ord}
            </button>
          );
        })}
        {playhead !== null ? (
          <span
            className="pointer-events-none absolute -bottom-1 -top-1 z-20 w-0.5 -translate-x-1/2 rounded-full bg-navy"
            style={{ left: pct(playhead) }}
            aria-hidden
          />
        ) : null}
      </div>

      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-secondary" aria-hidden>
        {ticks.map((t, i) => (
          <span key={i}>{formatClock(t)}</span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-secondary">
        {(["passed", "unverified", "failed"] as const).map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-sm", toneSolid[stepStatus[status].tone])} aria-hidden />
            {stepStatus[status].label}
          </span>
        ))}
        {flags.length ? (
          <span className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 10 9" className="h-2.5 w-2.5" aria-hidden>
              <path d="M5 0L10 9H0Z" className="fill-danger" />
            </svg>
            Safety flag
          </span>
        ) : null}
        {playhead !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-0.5 bg-navy" aria-hidden />
            Video position
          </span>
        ) : null}
      </div>

      {unlocated.length ? (
        <p className="mt-2 text-xs text-ink-secondary">
          Not found in the recording: {unlocated.map((s) => `${s.ord}. ${s.title}`).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
