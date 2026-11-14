import Link from "next/link";
import { caregiver } from "@/data/caregiver";

export function AvatarButton() {
  return (
    <Link
      href="/profile"
      aria-label="Open profile"
      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white ring-1 ring-white/20 transition-colors hover:bg-white/25"
    >
      {caregiver.avatarInitials}
    </Link>
  );
}
