import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[12px] border border-border bg-card shadow-[0_1px_3px_rgba(23,50,77,0.06)]",
        className,
      )}
      {...props}
    />
  );
}
