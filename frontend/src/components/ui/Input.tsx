import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const field =
  "w-full rounded-[12px] border border-border bg-white px-3 text-sm text-ink outline-none transition-shadow placeholder:text-ink-secondary focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-secondary disabled:text-ink-secondary read-only:bg-secondary";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, "py-2.5", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, "h-10", className)} {...props} />;
}

/** A labelled form control with an optional hint underneath. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-secondary">{hint}</span> : null}
    </label>
  );
}
