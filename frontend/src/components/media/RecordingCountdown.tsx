"use client";

import { Timer } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/format";
import { RECORDING_MAX_SECONDS } from "@/lib/recorder";

/**
 * The countdown to the recorder's length limit, for the last stretch of a recording
 * (pass useRecorder()'s `remaining` and `warning`). Screen readers hear it at 30, 20 and 10
 * seconds rather than every second.
 */
export function RecordingCountdown({
  remaining,
  warning,
  className,
}: {
  remaining: number;
  warning: boolean;
  className?: string;
}) {
  const spoken =
    warning && remaining <= 10
      ? "Recording stops in 10 seconds."
      : warning
        ? `Recording stops automatically in ${remaining > 20 ? 30 : 20} seconds.`
        : "";
  return (
    <>
      {warning ? (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full bg-warning px-2.5 py-1 text-xs font-semibold tabular-nums text-white",
            className,
          )}
        >
          <Timer className="h-3.5 w-3.5" aria-hidden />
          Stops in {formatClock(remaining)}
        </span>
      ) : null}
      <span className="sr-only" role="status">
        {spoken}
      </span>
    </>
  );
}

/** "Maximum video length is 4 minutes." — said before recording starts. */
export function recordingLimitNote(maxSeconds = RECORDING_MAX_SECONDS) {
  const minutes = maxSeconds / 60;
  const length = Number.isInteger(minutes) ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : formatClock(maxSeconds);
  return `Maximum video length is ${length}.`;
}
