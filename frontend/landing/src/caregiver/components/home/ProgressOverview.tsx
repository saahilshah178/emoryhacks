import { Card } from "@/caregiver/components/ui/Card";
import { ProgressBar } from "@/caregiver/components/ui/ProgressBar";

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
    <Card className="p-5">
      <p className="text-2xl font-semibold tracking-tight text-navy tabular-nums">
        {verified} of {total}{" "}
        <span className="text-base font-medium text-ink-secondary">skills verified</span>
      </p>
      <ProgressBar
        className="mt-4"
        value={verified}
        max={total}
        label="Skills verified"
      />
      <p className="mt-3 text-sm text-ink-secondary">
        {awaiting === 0
          ? "Nothing waiting on a nurse right now."
          : awaiting === 1
            ? "1 skill is awaiting nurse approval."
            : `${awaiting} skills are awaiting nurse approval.`}
      </p>
    </Card>
  );
}
