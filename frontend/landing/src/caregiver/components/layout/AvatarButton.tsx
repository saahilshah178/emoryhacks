import Link from "next/link";
import { caregiver } from "@/caregiver/data/caregiver";

export function AvatarButton() {
  return (
    <Link
      href="/portal/profile"
      aria-label="Open profile"
      className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-soft text-sm font-semibold text-teal ring-1 ring-border transition-colors hover:bg-teal/15"
    >
      {caregiver.avatarInitials}
    </Link>
  );
}
