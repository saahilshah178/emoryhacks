import Link from "next/link";
import type { MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { APP_NAME } from "./brand";

/** The heart-and-check icon inside the logo tile: care that has been verified. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />
      <path d="m8.5 11 2.5 2.5 4.5-4.5" />
    </svg>
  );
}

/** The brand mark. The same component is used on the public pages, the portal and the dashboard. */
export function Logo({
  href = "/",
  light = false,
  nameClassName,
  onClick,
}: {
  href?: string;
  light?: boolean;
  nameClassName?: string;
  /** Runs before the link is followed; call preventDefault() to stay on the page. */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link href={href} aria-label={APP_NAME} onClick={onClick} className="flex min-h-11 shrink-0 items-center gap-2.5">
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] text-white",
          light ? "bg-white/15 ring-1 ring-white/25" : "bg-teal",
        )}
      >
        <LogoMark className="h-[18px] w-[18px]" />
      </span>
      <span
        className={cn(
          "truncate font-display text-[16px] font-semibold tracking-tight",
          light ? "text-white" : "text-navy",
          nameClassName,
        )}
      >
        {APP_NAME}
      </span>
    </Link>
  );
}
