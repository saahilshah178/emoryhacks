import { formatClock } from "@/lib/format";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";
import type { DetectedStep } from "@/lib/types";

export function StepTimeline({
  steps,
  currentTime,
  onSelect,
}: {
  steps: DetectedStep[];
  currentTime: number;
  onSelect: (time: number) => void;
}) {
  return (
    <ol className="space-y-2">
      {steps.map((step, index) => {
        const active =
          currentTime >= step.timestamp &&
          (index === steps.length - 1 || currentTime < steps[index + 1].timestamp);
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onSelect(step.timestamp)}
              className={cn(
                "flex w-full items-start gap-3 rounded-[12px] border px-3 py-3 text-left transition-colors",
                active
                  ? "border-teal bg-teal-soft"
                  : "border-border bg-white hover:bg-page",
              )}
            >
              <span className="mt-0.5 w-10 shrink-0 text-xs font-semibold text-teal">
                {formatClock(step.timestamp)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{step.label}</span>
                  <StatusBadge status={step.status} />
                </span>
                <span className="mt-1 block text-xs text-ink-secondary">{step.note}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
