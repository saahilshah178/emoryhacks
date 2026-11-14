"use client";

import Link from "next/link";
import { initials } from "@/lib/format";
import { useUser } from "@/shared/AuthProvider";

export function AvatarButton() {
  const user = useUser();
  return (
    <Link
      href="/portal/profile"
      aria-label="Open profile"
      title={user.name}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-soft text-sm font-semibold text-teal ring-1 ring-border transition-colors hover:bg-teal/15"
    >
      {initials(user.name) || "?"}
    </Link>
  );
}
