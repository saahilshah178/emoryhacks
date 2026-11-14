import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";

export function ProgressOverview({
  verified,
  total,
  awaiting,
}: {
  verified: number;
  total: number;
  awaiting: number;
}) {
  return (
    <Card className="overflow-hidden p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Skills verified
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-navy">
            {verified} of {total}
          </p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-soft text-teal">
          <Sparkles className="h-5 w-5" aria-hidden />
        </span>
      </div>
      <ProgressBar
        className="mt-4"
        value={verified}
        max={total}
        label="Skills verified"
      />
      <p className="mt-3 text-sm font-medium text-teal">
        You&apos;re making great progress!
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {awaiting === 0
          ? "Nothing waiting on a nurse right now."
          : awaiting === 1
            ? "1 skill is awaiting nurse approval."
            : `${awaiting} skills are awaiting nurse approval.`}
      </p>
    </Card>
  );
}
