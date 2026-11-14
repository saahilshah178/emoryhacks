"use client";

import { attemptChapters } from "@/components/media/chapters";
import { StepChapters, type ChapterMarker } from "@/components/media/StepChapters";
import { cn } from "@/lib/cn";
import { formatClock, formatRange } from "@/lib/format";
import { flagSeverity, flagTitle, stepStatus, toneSolid } from "@/lib/status";
import type { AttemptStep, SafetyFlag } from "@/lib/types";
import { effectiveStatus, type Overrides } from "./steps";

/**
 * The attempt's steps as chapters of the submitted recording: a segment per located step
 * coloured by its status (the nurse's draft first), safety flags as markers above, the
 * playhead, the current step named under the bar with Previous / Next, and a legend.
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
  const chapters = attemptChapters(steps, (step) => {
    const status = effectiveStatus(step, overrides[step.step_id]);
    const entry = status ? stepStatus[status] : null;
    return { tone: entry?.tone ?? "neutral", hint: entry?.label ?? "not graded" };
  });
  const markers: ChapterMarker[] = flags.map((flag) => {
    const entry = flagSeverity[flag.severity];
    const when = flag.end_s !== null ? formatRange(flag.start_s, flag.end_s) : formatClock(flag.start_s);
    return {
      id: flag.id,
      at: flag.start_s,
      label: `safety flag: ${flagTitle(flag)} (${entry.label.toLowerCase()}), ${when}`,
      tone: entry.tone === "danger" ? "danger" : entry.tone === "warning" ? "warning" : "neutral",
      onClick: onPlayFlag ? () => onPlayFlag(flag.start_s, flag.end_s) : undefined,
    };
  });

  return (
    <StepChapters
      chapters={chapters}
      duration={duration}
      time={playhead}
      activeId={activeId}
      onSelect={(chapter) => {
        const step = steps.find((s) => s.step_id === chapter.id);
        if (step) onSelect(step);
      }}
      label="Steps in the submitted recording"
      emptyText={
        steps.some((s) => s.found === false)
          ? "None of the steps were found in this recording."
          : "No steps have been located in this recording yet."
      }
      missingText="Not found in the recording"
      markers={markers}
      footer={
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
      }
    />
  );
}
