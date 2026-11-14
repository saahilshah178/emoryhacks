import { Badge } from "@/components/ui";
import { TimeChip } from "@/components/media/TimeChip";
import { cn } from "@/lib/cn";
import { hasSpan } from "@/lib/format";
import { onlyNeededWhen } from "@/lib/steps";
import type { SkillStep } from "@/lib/types";

/**
 * The skill's steps, numbered. Timed steps get a chip that plays that stretch of the
 * reference video (pass the play function from useVideoSegments as onPlay).
 * A step that is only needed in some situations says when, in both forms.
 * compact: titles only, for a reminder under the camera. activeId highlights the step the
 * video is showing; each item carries data-step-id for useRevealInList.
 */
export function StepChecklist({
  steps,
  orderMatters,
  onPlay,
  title = "What you will show",
  compact = false,
  activeId = null,
}: {
  steps: SkillStep[];
  orderMatters: boolean;
  onPlay?: (start: number, end?: number | null) => void;
  title?: string;
  compact?: boolean;
  /** The step playing in the video beside the list. */
  activeId?: string | null;
}) {
  const ordered = [...steps].sort((a, b) => a.ord - b.ord);
  return (
    <section>
      <h2 className="text-sm font-semibold text-navy">{title}</h2>
      {orderMatters ? (
        <p className="mt-1 text-sm text-ink-secondary">Do the steps in this order.</p>
      ) : null}
      {ordered.length === 0 ? (
        <p className="mt-3 text-sm text-ink-secondary">Your nurse hasn&apos;t listed the steps for this skill yet.</p>
      ) : (
        <ol className={cn("mt-3", compact ? "space-y-2" : "space-y-3")}>
          {ordered.map((step, index) => {
            const on = step.step_id === activeId;
            const condition = onlyNeededWhen(step);
            return (
              <li
                key={step.step_id}
                data-step-id={step.step_id}
                aria-current={on ? "step" : undefined}
                className={cn(
                  "flex gap-3 rounded-[10px] transition-colors",
                  !compact && "-mx-2 px-2 py-1.5",
                  on && "bg-teal-soft ring-1 ring-teal",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                    on ? "bg-teal text-white" : "bg-teal-soft text-teal",
                  )}
                  aria-hidden
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-semibold text-navy">
                      <span className="sr-only">Step {index + 1}: </span>
                      {step.title}
                    </p>
                    {step.critical ? <Badge tone="danger">Critical</Badge> : null}
                  </div>
                  {!compact && step.description ? (
                    <p className="mt-0.5 text-sm leading-relaxed text-ink-secondary">{step.description}</p>
                  ) : null}
                  {condition ? <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{condition}</p> : null}
                  {!compact && hasSpan(step.start_s, step.end_s) ? (
                    <TimeChip
                      className={cn("mt-1.5", on && "bg-white")}
                      start={step.start_s}
                      end={step.end_s}
                      onPlay={onPlay}
                      title={onPlay ? undefined : "Where this step is in the demonstration"}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
