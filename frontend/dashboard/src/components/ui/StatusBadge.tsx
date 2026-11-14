import { cn } from "@/lib/cn";
import type { AiAssessment, ReviewStatus, StepStatus } from "@/lib/types";

const styles = {
  passed: "bg-success-bg text-success",
  needs_review: "bg-warning-bg text-warning",
  safety_concern: "bg-danger-bg text-danger",
  failed: "bg-danger-bg text-danger",
  pending: "bg-warning-bg text-warning",
  approved: "bg-success-bg text-success",
  retraining_requested: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
};

const labels: Record<string, string> = {
  passed: "Passed",
  needs_review: "Needs Review",
  safety_concern: "Safety Concern",
  failed: "Failed",
  pending: "Awaiting Nurse",
  approved: "Approved",
  retraining_requested: "Retraining Requested",
  info: "AI Insight",
};

type Tone = keyof typeof styles;

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: AiAssessment | ReviewStatus | StepStatus | "info";
  label?: string;
  className?: string;
}) {
  const tone = status as Tone;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        styles[tone],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? labels[status]}
    </span>
  );
}

export function assessmentLabel(status: AiAssessment) {
  return labels[status];
}
