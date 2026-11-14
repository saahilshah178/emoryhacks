import { CircleUserRound, Home, ListChecks } from "lucide-react";
import type { RailItem } from "@/shared/layout/Rail";

/** The portal's pages. On a laptop: these two in the rail, the profile at its foot. */
export const mainNav: RailItem[] = [
  { href: "/portal", label: "Home", icon: Home, exact: true },
  { href: "/portal/skills", label: "My skills", icon: ListChecks },
];

export const profileNav: RailItem = { href: "/portal/profile", label: "Profile", icon: CircleUserRound };

/** On a phone: all three along the bottom of the screen. */
export const bottomNav: RailItem[] = [...mainNav, profileNav];
