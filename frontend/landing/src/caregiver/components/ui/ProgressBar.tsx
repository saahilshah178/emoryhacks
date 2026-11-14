import { cn } from "@/caregiver/lib/cn";

export function ProgressBar({
  value,
  max,
  className,
  label,
}: {
  value: number;
  max: number;
  className?: string;
  label?: string;
}) {
  const percent = max === 0 ? 0 : Math.round((value / max) * 100);

  return (
    <div className={cn("w-full", className)}>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className="h-2.5 w-full overflow-hidden rounded-full bg-bg-secondary"
      >
        <div
          className="h-full rounded-full bg-teal transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
