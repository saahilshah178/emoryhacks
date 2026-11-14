import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-block h-5 w-5 animate-spin rounded-full border-2 border-teal-soft border-t-teal", className)}
    />
  );
}

/** A grey block that stands in for content while it loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[12px] bg-secondary", className)} aria-hidden />;
}

/** Shown where a list or section has nothing in it yet. Say what will appear here and how. */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[12px] border border-dashed border-border bg-white px-5 py-8 text-center", className)}>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-ink-secondary">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** An error the user can act on. */
export function ErrorNote({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger",
        className,
      )}
    >
      <p>{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The standard way to render something loaded with useApi: a skeleton while it loads the
 * first time, an error with a retry if it fails, otherwise the content.
 */
export function Loadable<T>({
  data,
  error,
  loading,
  reload,
  skeleton,
  children,
}: {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload?: () => void;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (data !== undefined) return <>{children(data)}</>;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading) return <>{skeleton ?? <Skeleton className="h-40" />}</>;
  return null;
}
