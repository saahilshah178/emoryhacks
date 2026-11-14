import { Card, ProgressBar } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { MySkills } from "@/lib/types";

function waitingLine(counts: MySkills["counts"], ready: number) {
  const parts: string[] = [];
  if (ready > 0) {
    parts.push(ready === 1 ? "1 recording is ready to send to your nurse." : `${ready} recordings are ready to send to your nurse.`);
  }
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

/**
 * Where the caregiver stands, on one card. The phone version of ProgressTiles.
 * ready: how many skills have a recording ready to send.
 */
export function ProgressOverview({ counts, ready = 0, className }: { counts: MySkills["counts"]; ready?: number; className?: string }) {
  return (
    <Card className={cn("p-5", className)}>
      <p className="text-2xl font-semibold tracking-tight text-navy tabular-nums">
        {counts.verified} of {counts.total}{" "}
        <span className="text-base font-medium text-ink-secondary">skills verified</span>
      </p>
      <ProgressBar className="mt-4" value={counts.verified} max={counts.total} label="Skills verified" />
      <p className="mt-3 text-sm text-ink-secondary">{waitingLine(counts, ready)}</p>
    </Card>
  );
}
