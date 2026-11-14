"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A whole-number field with − and + either side. The text is kept as typed, so a nurse can
 * clear it and type a new number; the parent parses it (parseCount / parsePercent).
 */
export function NumberStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  suffix,
  invalid = false,
  disabled = false,
  size = "md",
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  min: number;
  max: number;
  step?: number;
  /** Read by screen readers. */
  label: string;
  /** Shown after the number, e.g. "%". */
  suffix?: string;
  invalid?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  id?: string;
}) {
  const current = Number(value);
  const known = value.trim() !== "" && Number.isFinite(current);

  function nudge(direction: 1 | -1) {
    const base = known ? current : direction > 0 ? min - step : max + step;
    // Snap to the step grid first, so 72 + 5 gives 75 rather than 77.
    const snapped = direction > 0 ? Math.floor(base / step) * step + step : Math.ceil(base / step) * step - step;
    onChange(String(Math.min(max, Math.max(min, snapped))));
  }

  const button = cn(
    "flex shrink-0 items-center justify-center text-ink-secondary transition-colors hover:bg-secondary hover:text-ink disabled:cursor-not-allowed disabled:opacity-40",
    size === "sm" ? "h-8 w-8" : "h-10 w-10",
  );

  return (
    <div
      className={cn(
        "inline-flex items-center overflow-hidden rounded-[12px] border bg-white",
        invalid ? "border-danger" : "border-border",
        size === "sm" ? "h-8 rounded-[10px]" : "h-10",
      )}
    >
      <button
        type="button"
        className={button}
        onClick={() => nudge(-1)}
        disabled={disabled || (known && current <= min)}
        aria-label={`Fewer: ${label}`}
      >
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <label className="flex items-center border-x border-border px-1">
        <span className="sr-only">{label}</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              nudge(1);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              nudge(-1);
            }
          }}
          className={cn(
            "bg-transparent text-center font-semibold tabular-nums text-ink outline-none",
            size === "sm" ? "w-8 text-xs" : "w-11 text-sm",
          )}
        />
        {suffix ? <span className={cn("pr-1 text-ink-secondary", size === "sm" ? "text-xs" : "text-sm")}>{suffix}</span> : null}
      </label>
      <button
        type="button"
        className={button}
        onClick={() => nudge(1)}
        disabled={disabled || (known && current >= max)}
        aria-label={`More: ${label}`}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
