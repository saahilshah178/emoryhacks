import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/nurse/lib/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "destructive" | "ghost";
  size?: "sm" | "md" | "lg";
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-secondary disabled:text-ink-muted disabled:border-transparent",
        size === "sm" && "h-8 rounded-[10px] px-3 text-xs",
        size === "md" && "h-10 rounded-[12px] px-4 text-sm",
        size === "lg" && "h-11 rounded-[12px] px-5 text-sm",
        variant === "primary" && "bg-teal text-white shadow-sm hover:bg-teal-hover",
        variant === "secondary" &&
          "bg-white text-teal border border-teal hover:bg-teal-soft",
        variant === "destructive" && "bg-danger text-white hover:bg-[#c44743]",
        variant === "ghost" && "bg-transparent text-ink-secondary hover:bg-secondary hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}
