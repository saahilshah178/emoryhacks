import Link from "next/link";
import { APP_NAME } from "@/config/branding";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/portal"
      aria-label={APP_NAME}
      className="flex min-h-11 shrink-0 items-center gap-2.5"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-teal text-sm font-semibold text-white">
        {APP_NAME.charAt(0)}
      </span>
      <span
        className={`truncate text-[15px] font-semibold tracking-tight ${
          light ? "text-white" : "text-navy"
        }`}
      >
        {APP_NAME}
      </span>
    </Link>
  );
}
