import type { ReactNode } from "react";

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
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
