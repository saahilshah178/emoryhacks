import { ArrowDownUp, Stethoscope } from "lucide-react";
import { Badge, StateBadge } from "@/components/ui";
import { TimeChip } from "@/components/media/TimeChip";
import { cn } from "@/lib/cn";
import { hasSpan } from "@/lib/format";
import { stepStatusForCaregiver, toneClass } from "@/lib/status";
import type { AttemptStep, OrderViolation } from "@/lib/types";

/** Where the step happens in the caregiver's video: where it was found, else what the check looked at. */
export function stepSpan(step: AttemptStep): [number | null, number | null] {
  if (step.start_s !== null && step.start_s !== undefined) return [step.start_s, step.end_s];
  return [step.evidence_start_s, step.evidence_end_s];
}

/**
 * One step of a graded attempt in the caregiver's words. Where a nurse changed the
 * result, the nurse's result and note come first and the automatic check's reading
 * follows, marked as replaced.
 */
export function StepResult({
  step,
  number,
  violations,
  onPlay,
}: {
  step: AttemptStep;
  number: number;
  violations: OrderViolation[];
  /** Plays a stretch of the caregiver's video; absent when the video can't be played here. */
  onPlay?: (start: number, end?: number | null) => void;
}) {
  const effective = step.nurse_status ?? step.status;
  const entry = effective ? stepStatusForCaregiver[effective] : null;
  const changed = step.nurse_status !== null && step.status !== null && step.nurse_status !== step.status;
  const aiEntry = step.status ? stepStatusForCaregiver[step.status] : null;
  const [start, end] = stepSpan(step);
  const notes = violations.filter((violation) => violation.step_id === step.step_id);

  return (
    <li className="flex items-start gap-3 px-4 py-4">
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
          entry ? toneClass[entry.tone] : toneClass.neutral,
        )}
        aria-hidden
      >
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <h3 className="min-w-0 text-sm font-semibold text-navy">
            <span className="sr-only">Step {number}: </span>
            {step.title}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {step.critical ? <Badge tone="danger">Critical</Badge> : null}
            {entry ? <StateBadge entry={entry} /> : <Badge>Not checked</Badge>}
          </div>
        </div>

        {step.nurse_status ? (
          <div className="flex gap-2 rounded-[12px] bg-teal-soft px-3 py-2.5">
            <Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden />
            <p className="text-sm leading-relaxed text-navy">
              <span className="font-semibold">Your nurse: </span>
              {step.nurse_note ||
                (changed ? "Your nurse changed the result of this step." : "Your nurse agreed with this result.")}
            </p>
          </div>
        ) : null}

        {changed && aiEntry ? (
          <div className="rounded-[12px] border border-dashed border-border px-3 py-2 text-sm text-ink-secondary">
            <p className="text-xs font-semibold uppercase tracking-wide">
              Automatic check · replaced by your nurse
            </p>
            <p className="mt-1">
              <span className="line-through">{aiEntry.label}</span>
              {step.feedback ? ` — ${step.feedback}` : ""}
            </p>
          </div>
        ) : step.feedback ? (
          <p className="text-sm leading-relaxed text-ink">{step.feedback}</p>
        ) : null}

        {notes.map((violation, index) => (
          <p key={index} className="flex gap-2 rounded-[12px] bg-warning-bg px-3 py-2 text-sm text-warning">
            <ArrowDownUp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>Out of order: {violation.message}</span>
          </p>
        ))}

        {hasSpan(start, end) ? (
          <TimeChip
            start={start}
            end={end}
            onPlay={onPlay}
            title={onPlay ? undefined : "Where this step is in your recording"}
          />
        ) : null}
      </div>
    </li>
  );
}
