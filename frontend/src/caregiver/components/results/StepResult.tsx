import { ArrowDownUp, EyeOff, Stethoscope } from "lucide-react";
import { Badge, StateBadge } from "@/components/ui";
import { attemptStepSpan } from "@/components/media/chapters";
import { TimeChip } from "@/components/media/TimeChip";
import { cn } from "@/lib/cn";
import { hasSpan } from "@/lib/format";
import { stepStatusForCaregiver, toneClass } from "@/lib/status";
import { isNotNeeded, onlyNeededWhen, savedStatus } from "@/lib/steps";
import type { AttemptStep, OrderViolation } from "@/lib/types";

/**
 * One step of a graded attempt in the caregiver's words. Where a nurse changed the
 * result, the nurse's result and note come first and the automatic check's reading
 * follows, marked as replaced. Under it: where the step is in the caregiver's recording
 * (or that it was not seen) and, when the reference can be played, the same step in the
 * nurse's demonstration, so the two can be compared. A step that is only needed sometimes
 * says when; one that was not needed this time says why, and has no place in the recording.
 */
export function StepResult({
  step,
  number,
  violations,
  onPlay,
  onPlayDemo,
  active = false,
}: {
  step: AttemptStep;
  number: number;
  violations: OrderViolation[];
  /** Plays a stretch of the caregiver's video; absent when the video can't be played here. */
  onPlay?: (start: number, end?: number | null) => void;
  /** Plays a stretch of the reference video; absent when there is none to play. */
  onPlayDemo?: (start: number, end?: number | null) => void;
  /** The caregiver's recording is showing this step. */
  active?: boolean;
}) {
  const effective = savedStatus(step);
  const notNeeded = isNotNeeded(effective);
  const condition = onlyNeededWhen(step);
  const entry = effective ? stepStatusForCaregiver[effective] : null;
  const changed = step.nurse_status !== null && step.status !== null && step.nurse_status !== step.status;
  const aiEntry = step.status ? stepStatusForCaregiver[step.status] : null;
  const span = attemptStepSpan(step);
  const demo = Boolean(onPlayDemo) && hasSpan(step.ref_start_s, step.ref_end_s);
  const notes = violations.filter((violation) => violation.step_id === step.step_id);

  return (
    <li
      data-step-id={step.step_id}
      aria-current={active ? "step" : undefined}
      className={cn("flex items-start gap-3 px-4 py-4 transition-colors", active && "bg-teal-soft/60")}
    >
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
            {step.critical ? <Badge tone="warning">Critical</Badge> : null}
            {entry ? <StateBadge entry={entry} /> : <Badge>Not checked</Badge>}
          </div>
        </div>

        {condition ? <p className="text-xs leading-relaxed text-ink-secondary">{condition}</p> : null}

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

        {span || !notNeeded || demo ? (
          <div className="flex flex-wrap items-center gap-2">
            {span ? (
              <TimeChip
                start={span.start}
                end={span.end}
                onPlay={onPlay}
                prefix="Your recording"
                title={
                  onPlay
                    ? undefined
                    : span.byGrader
                      ? "Where the check looked in your recording"
                      : "Where this step is in your recording"
                }
              />
            ) : notNeeded ? null : (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-xs font-medium text-ink-secondary">
                <EyeOff className="h-3.5 w-3.5" aria-hidden />
                Not seen in your recording
              </span>
            )}
            {demo ? (
              <TimeChip
                start={step.ref_start_s}
                end={step.ref_end_s}
                onPlay={onPlayDemo}
                prefix="Demonstration"
                className="bg-info-bg text-info hover:bg-info hover:text-white"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
