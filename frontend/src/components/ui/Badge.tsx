import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { toneClass, type Tone } from "@/lib/status";

/** A small pill. Take label and tone from lib/status so a state always reads the same. */
export function Badge({
  tone = "neutral",
  dot = false,
  className,
  title,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
        toneClass[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

/** A badge for one of the entries in lib/status, e.g. <StateBadge entry={reviewState[a.review_state]} />. */
export function StateBadge({
  entry,
  label,
  className,
}: {
  entry: { label: string; tone: Tone } | null | undefined;
  /** Overrides the entry's label, keeping its colour. */
  label?: string;
  className?: string;
}) {
  if (!entry) return null;
  return (
    <Badge tone={entry.tone} dot className={className}>
      {label ?? entry.label}
    </Badge>
  );
}
