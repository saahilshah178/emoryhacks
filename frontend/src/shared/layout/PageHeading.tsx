import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The heading every page of the dashboard and the caregiver portal starts with: the title
 * at the left edge of the page's column, a line or two under it, and buttons or badges at
 * the right edge.
 */
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
  titleClassName,
}: {
  /** A short label above the title, such as the step of a flow. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-teal">{eyebrow}</p> : null}
        <h1 className={cn("text-xl font-semibold tracking-tight text-navy", titleClassName)}>{title}</h1>
        {description ? <div className="mt-1 max-w-2xl text-sm text-ink-secondary">{description}</div> : null}
      </div>
      {actions}
    </div>
  );
}
