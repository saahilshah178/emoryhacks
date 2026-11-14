import { cn } from "@/nurse/lib/cn";

export function ProgressBar({
  value,
  className,
  barClassName,
}: {
  value: number;
  className?: string;
  barClassName?: string;
}) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}>
      <div
        className={cn("h-full rounded-full bg-teal transition-[width]", barClassName)}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
