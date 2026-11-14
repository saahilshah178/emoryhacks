import { Badge } from "@/components/ui";
import { TimeChip } from "@/components/media/TimeChip";
import { cn } from "@/lib/cn";
import { hasSpan } from "@/lib/format";
import type { SkillStep } from "@/lib/types";

/**
 * The skill's steps, numbered. Timed steps get a chip that plays that stretch of the
 * reference video (pass the play function from useVideoSegments as onPlay).
 * compact: titles only, for a reminder under the camera.
 */
export function StepChecklist({
  steps,
  orderMatters,
  onPlay,
  title = "What you will show",
  compact = false,
}: {
  steps: SkillStep[];
  orderMatters: boolean;
  onPlay?: (start: number, end?: number | null) => void;
  title?: string;
  compact?: boolean;
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
          {ordered.map((step, index) => (
            <li key={step.step_id} className="flex gap-3">
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold tabular-nums text-teal"
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
                  {step.critical ? <Badge tone="warning">Critical</Badge> : null}
                </div>
                {!compact && step.description ? (
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-secondary">{step.description}</p>
                ) : null}
                {!compact && hasSpan(step.start_s, step.end_s) ? (
                  <TimeChip
                    className="mt-1.5"
                    start={step.start_s}
                    end={step.end_s}
                    onPlay={onPlay}
                    title={onPlay ? undefined : "Where this step is in the demonstration"}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
