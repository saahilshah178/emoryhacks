import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

const variants = {
  primary: "bg-teal text-white shadow-sm hover:bg-teal-hover",
  secondary: "border border-teal bg-white text-teal hover:bg-teal-soft",
  destructive: "bg-danger text-white hover:bg-[#971c13]",
  ghost: "bg-transparent text-ink-secondary hover:bg-secondary hover:text-ink",
};

// The nurse dashboard uses sm and md. The caregiver portal is used on phones, so its
// buttons are lg (48px) and xl (56px) for comfortable touch targets.
const sizes = {
  sm: "h-8 rounded-[10px] px-3 text-xs",
  md: "h-10 rounded-[12px] px-4 text-sm",
  lg: "min-h-12 rounded-[12px] px-5 text-[15px]",
  xl: "min-h-14 rounded-[12px] px-6 text-base",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Renders a link that looks like a button. */
  href?: string;
  /** Shows a spinner and blocks clicks while something is being saved. */
  loading?: boolean;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  href,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 font-semibold transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2",
    "disabled:cursor-not-allowed disabled:border-transparent disabled:bg-secondary disabled:text-ink-muted disabled:shadow-none",
    variants[variant],
    sizes[size],
    className,
  );

  if (href && !disabled && !loading) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      ) : null}
      {children}
    </button>
  );
}
