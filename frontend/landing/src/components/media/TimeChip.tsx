"use client";

import { Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatClock, formatRange, hasSpan } from "@/lib/format";

/**
 * A timestamp you can press. With an end it reads "0:05–0:08" and plays that stretch, then
 * stops; without one it reads "0:05" and plays on from there. Renders nothing when there is
 * no start time. Pass the play function from useVideoSegments() as onPlay.
 */
export function TimeChip({
  start,
  end,
  onPlay,
  title,
  className,
}: {
  start: number | null | undefined;
  end?: number | null;
  onPlay?: (start: number, end?: number | null) => void;
  title?: string;
  className?: string;
}) {
  if (start === null || start === undefined || Number.isNaN(Number(start))) return null;
  // A step whose start and end are both 0 has not been timed: there is nothing to show.
  if (Number(start) === 0 && end !== null && end !== undefined && Number(end) === 0) return null;
  const ranged = hasSpan(start, end);
  const label = ranged ? formatRange(start, end as number) : formatClock(start);
  const classes = cn(
    "inline-flex h-7 items-center gap-1 rounded-full bg-teal-soft px-2.5 text-xs font-semibold tabular-nums text-teal",
    className,
  );
  if (!onPlay) return <span className={classes}>{label}</span>;
  return (
    <button
      type="button"
      title={title ?? (ranged ? `Play ${label}, then stop` : `Play from ${label}`)}
      onClick={(event) => {
        event.stopPropagation();
        onPlay(start, ranged ? end : null);
      }}
      className={cn(classes, "transition-colors hover:bg-teal hover:text-white")}
    >
      <Play className="h-3 w-3 fill-current" aria-hidden />
      {label}
    </button>
  );
}
