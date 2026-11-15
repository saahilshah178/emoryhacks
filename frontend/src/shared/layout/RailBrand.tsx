"use client";

import type { MouseEvent } from "react";
import { useUser } from "@/shared/AuthProvider";
import { agencyCaption } from "@/shared/JoinAgency";
import { Logo } from "@/shared/Logo";

/**
 * The top of the sidebar: the Ready2Care logo with the organisation's name under it.
 * Below the `lg` width, when the sidebar shows icons only, just the logo tile.
 */
export function RailBrand({
  href,
  onClick,
}: {
  href: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const user = useUser();
  return (
    <div className="flex shrink-0 flex-col justify-center px-4 pb-3 pt-4 max-lg:items-center">
      <Logo href={href} light nameClassName="hidden lg:inline" onClick={onClick} />
      <p className="hidden truncate pl-[42px] text-xs text-white/65 lg:block">{agencyCaption(user)}</p>
    </div>
  );
}
