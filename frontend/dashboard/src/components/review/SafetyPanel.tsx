import { AlertTriangle } from "lucide-react";
import { formatClock } from "@/lib/format";
import type { SafetyIssue } from "@/lib/types";

export function SafetyPanel({
  issues,
  onSeek,
}: {
  issues: SafetyIssue[];
  onSeek: (time: number) => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="rounded-[12px] border border-success/20 bg-success-bg p-4">
        <p className="text-sm font-semibold text-success">No safety flags detected</p>
        <p className="mt-1 text-sm text-ink-secondary">
          AI did not find a critical miss. Nurse review is still required before certification.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-danger/20 bg-danger-bg p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" />
        <div>
          <p className="text-sm font-semibold text-danger">
            {issues.length === 1
              ? "1 safety issue requires nurse attention"
              : `${issues.length} safety issues require nurse attention`}
          </p>
          <p className="mt-1 text-xs text-ink-secondary">
            These findings are recommendations only. You decide whether the skill is approved.
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {issues.map((issue) => (
          <li key={issue.id}>
            <button
              type="button"
              onClick={() => onSeek(issue.timestamp)}
              className="w-full rounded-[12px] bg-white px-3 py-3 text-left hover:bg-page"
            >
              <p className="text-sm font-medium text-ink">
                {issue.title} — {formatClock(issue.timestamp)}
              </p>
              <p className="mt-1 text-xs text-ink-secondary">{issue.detail}</p>
              <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-danger">
                {issue.severity === "critical" ? "Critical" : "Moderate"}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
