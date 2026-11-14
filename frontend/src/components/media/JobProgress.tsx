import { Check, CircleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { stageLabel } from "@/lib/status";
import type { Job } from "@/lib/types";

/** The pipeline's stages as a checklist that fills in while a video is processed. */
export function JobProgress({ job, className }: { job: Pick<Job, "stages" | "status"> | null; className?: string }) {
  const stages = job?.stages ?? [];
  if (stages.length === 0) {
    return <p className={cn("text-sm text-ink-secondary", className)}>Waiting to start…</p>;
  }
  // A stage that errors is normally skipped and the rest carry on. The one that stopped the
  // whole job is the errored stage with nothing but untouched stages after it.
  const stoppedAt =
    job?.status === "error"
      ? stages.findIndex((stage, index) => stage.status === "error" && stages.slice(index + 1).every((s) => s.status === "pending"))
      : -1;
  return (
    <ol className={cn("space-y-2", className)}>
      {stages.map((stage, index) => (
        <li key={stage.name} className="flex items-center gap-3 text-sm">
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              stage.status === "done" && "bg-success-bg text-success",
              stage.status === "error" && "bg-danger-bg text-danger",
              stage.status === "running" && "border-2 border-teal-soft border-t-teal animate-spin",
              stage.status === "pending" && "border-2 border-border",
            )}
            aria-hidden
          >
            {stage.status === "done" ? <Check className="h-3 w-3" /> : null}
            {stage.status === "error" ? <CircleAlert className="h-3 w-3" /> : null}
          </span>
          <span
            className={cn(
              stage.status === "pending" ? "text-ink-secondary" : "text-ink",
              stage.status === "running" && "font-medium",
            )}
          >
            {stageLabel[stage.name] ?? stage.name}
            {stage.status === "error" ? (index === stoppedAt ? " (failed)" : " (skipped)") : ""}
          </span>
          {stage.status === "done" && stage.seconds !== undefined ? (
            <span className="ml-auto text-xs tabular-nums text-ink-secondary">{Math.round(stage.seconds)}s</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
