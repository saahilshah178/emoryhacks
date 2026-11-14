import type { SkillStatus } from "@/types/skill";
import { Badge } from "@/components/ui/Badge";

const statusCopy: Record<SkillStatus, { label: string; className: string }> = {
  not_started: {
    label: "Not started",
    className: "bg-bg-secondary text-text-secondary",
  },
  ready_to_record: {
    label: "Ready to record",
    className: "bg-info-bg text-info",
  },
  in_review: {
    label: "In review",
    className: "bg-warning-bg text-warning",
  },
  verified: {
    label: "Verified",
    className: "bg-success-bg text-success",
  },
};

export function StatusBadge({ status }: { status: SkillStatus }) {
  const copy = statusCopy[status];
  return <Badge className={copy.className}>{copy.label}</Badge>;
}

export function skillActionLabel(status: SkillStatus) {
  if (status === "not_started") return "Start Practice";
  if (status === "ready_to_record") return "Record Skill";
  return "View Results";
}
