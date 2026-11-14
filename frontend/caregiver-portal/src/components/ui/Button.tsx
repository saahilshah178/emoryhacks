import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

const variants = {
  primary:
    "bg-teal text-white hover:bg-[#1d7b80] active:bg-[#1a6e72] shadow-[0_1px_2px_rgba(23,50,77,0.12)]",
  secondary:
    "bg-card text-teal border border-teal hover:bg-teal-soft active:bg-teal-soft",
  destructive: "bg-error text-white hover:bg-[#c44743] active:bg-[#b03f3b]",
  ghost: "bg-transparent text-navy hover:bg-bg-secondary",
};

const sizes = {
  md: "min-h-12 px-5 text-[15px]",
  lg: "min-h-14 px-6 text-base",
  sm: "min-h-10 px-4 text-sm",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  href?: string;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  href,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 rounded-[12px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-bg-secondary disabled:text-text-muted disabled:border-transparent disabled:shadow-none",
    variants[variant],
    sizes[size],
    className,
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} disabled={disabled} {...props}>
      {children}
    </button>
  );
}
