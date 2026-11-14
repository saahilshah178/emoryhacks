import type { HTMLAttributes } from "react";
import { cn } from "@/caregiver/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[12px] border border-border bg-card shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}
