"use client";

import { useEffect, useId, type ReactNode } from "react";
import { Button } from "@/components/ui";

/** A modal question with a confirm and a cancel button. Escape or the backdrop cancels. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "primary",
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "destructive";
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        className="absolute inset-0 cursor-default bg-navy/40"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-[12px] border border-border bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-navy">
          {title}
        </h2>
        <div className="mt-2 space-y-2 text-sm text-ink-secondary">{children}</div>
        {error ? (
          <p role="alert" className="mt-3 rounded-[12px] bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={busy} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
