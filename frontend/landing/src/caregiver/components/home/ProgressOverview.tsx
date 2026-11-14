import { Card, ProgressBar } from "@/components/ui";
import type { MySkills } from "@/lib/types";

function waitingLine(counts: MySkills["counts"]) {
  const parts: string[] = [];
  if (counts.in_review > 0) {
    parts.push(
      counts.in_review === 1 ? "1 skill is with a nurse for review." : `${counts.in_review} skills are with a nurse for review.`,
    );
  }
  if (counts.needs_practice > 0) {
    parts.push(
      counts.needs_practice === 1
        ? "A nurse asked you to practice 1 skill again."
        : `A nurse asked you to practice ${counts.needs_practice} skills again.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : "Nothing waiting on a nurse right now.";
}

export function ProgressOverview({ counts }: { counts: MySkills["counts"] }) {
  return (
    <Card className="p-5">
      <p className="text-2xl font-semibold tracking-tight text-navy tabular-nums">
        {counts.verified} of {counts.total}{" "}
        <span className="text-base font-medium text-ink-secondary">skills verified</span>
      </p>
      <ProgressBar className="mt-4" value={counts.verified} max={counts.total} label="Skills verified" />
      <p className="mt-3 text-sm text-ink-secondary">{waitingLine(counts)}</p>
    </Card>
  );
}
