import Link from "next/link";
import { caregiver } from "@/data/caregiver";

export function AvatarButton() {
  return (
    <Link
      href="/profile"
      aria-label="Open profile"
      className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-soft text-sm font-semibold text-navy ring-1 ring-border"
    >
      {caregiver.avatarInitials}
    </Link>
  );
}
