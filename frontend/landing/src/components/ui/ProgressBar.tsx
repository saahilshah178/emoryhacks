import { cn } from "@/lib/cn";

export function ProgressBar({
  value,
  max = 100,
  label,
  className,
  barClassName,
}: {
  value: number;
  max?: number;
  /** Read by screen readers. */
  label?: string;
  className?: string;
  /** The bar's colour class, e.g. "bg-danger". Defaults to teal. */
  barClassName?: string;
}) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
    >
      <div
        className={cn("h-full rounded-full bg-teal transition-[width] duration-500", barClassName)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
