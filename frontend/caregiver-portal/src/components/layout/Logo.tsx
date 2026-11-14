import Link from "next/link";
import { APP_NAME } from "@/config/branding";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 min-h-11">
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-[10px] text-sm font-bold ${
          light ? "bg-teal text-white" : "bg-teal text-white"
        }`}
      >
        {APP_NAME.charAt(0)}
      </span>
      <span
        className={`text-[15px] font-semibold tracking-tight ${
          light ? "text-white" : "text-navy"
        }`}
      >
        {APP_NAME}
      </span>
    </Link>
  );
}
