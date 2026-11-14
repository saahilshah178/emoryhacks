import Link from "next/link";
import { cn } from "@/lib/cn";
import { APP_NAME } from "./brand";

/** The brand mark. The same component is used on the public pages, the portal and the dashboard. */
export function Logo({
  href = "/",
  light = false,
  nameClassName,
}: {
  href?: string;
  light?: boolean;
  nameClassName?: string;
}) {
  return (
    <Link href={href} aria-label={APP_NAME} className="flex min-h-11 shrink-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-teal text-sm font-semibold text-white">
        {APP_NAME.charAt(0)}
      </span>
      <span
        className={cn(
          "truncate text-[15px] font-semibold tracking-tight",
          light ? "text-white" : "text-navy",
          nameClassName,
        )}
      >
        {APP_NAME}
      </span>
    </Link>
  );
}
