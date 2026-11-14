import type { ReactNode } from "react";

/**
 * The heading every dashboard page starts with: the title at the left edge of the page's
 * column, a line or two under it, and buttons or badges at the right edge.
 */
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-navy">{title}</h1>
        {description ? <div className="mt-1 max-w-2xl text-sm text-ink-secondary">{description}</div> : null}
      </div>
      {actions}
    </div>
  );
}
