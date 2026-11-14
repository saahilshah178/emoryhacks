import { ProgressBar } from "@/nurse/components/ui/ProgressBar";
import { StatusBadge } from "@/nurse/components/ui/StatusBadge";
import { formatClock } from "@/nurse/lib/format";
import { cn } from "@/nurse/lib/cn";
import type { BalancePoint, MovementIndicator } from "@/nurse/lib/types";

export function MovementPanel({
  balance,
  movement,
  duration,
}: {
  balance: BalancePoint[];
  movement: MovementIndicator[];
  duration: number;
}) {
  const max = Math.max(...balance.map((point) => point.score), 100);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-ink">Client balance monitoring</p>
        <p className="mt-1 text-xs text-ink-secondary">
          Estimated stability score across the demonstration. Dips below 70 need a closer look.
        </p>
        <div className="mt-3 flex h-24 items-end gap-1 rounded-[12px] bg-secondary px-3 py-3">
          {balance.map((point) => (
            <div key={point.time} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div
                className={cn(
                  "w-full max-w-6 rounded-t-md",
                  point.score < 60 ? "bg-danger" : point.score < 75 ? "bg-warning" : "bg-teal",
                )}
                style={{ height: `${(point.score / max) * 100}%` }}
                title={`${formatClock(point.time)} · ${point.score}`}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-ink-muted">
          <span>0:00</span>
          <span>{formatClock(duration)}</span>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-ink">Body movement analysis</p>
        <ul className="mt-3 space-y-3">
          {movement.map((item) => (
            <li key={item.label}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm text-ink">{item.label}</span>
                <StatusBadge status={item.status} />
              </div>
              <ProgressBar
                value={item.value}
                barClassName={
                  item.status === "failed"
                    ? "bg-danger"
                    : item.status === "needs_review"
                      ? "bg-warning"
                      : "bg-teal"
                }
              />
              <p className="mt-1 text-xs text-ink-secondary">{item.note}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
