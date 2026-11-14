import {
  BadgeCheck,
  BookOpenCheck,
  ClipboardList,
  LayoutDashboard,
  Plus,
  Settings,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Which count from the overview sits next to the label in the sidebar. */
  badge?: "pending" | "safety";
  /** Other routes that belong to this item, e.g. a review opened from the pending list. */
  also?: string[];
  /** Other words someone might type in the search box to find this page. */
  keywords?: string;
};

/** The sidebar, top to bottom. */
export const primaryNav: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, keywords: "dashboard home activity" },
  {
    href: "/dashboard/pending",
    label: "Pending reviews",
    icon: ClipboardList,
    badge: "pending",
    also: ["/dashboard/reviews"],
    keywords: "queue submissions waiting",
  },
  { href: "/dashboard/caregivers", label: "Caregivers", icon: Users, keywords: "roster staff people" },
  { href: "/dashboard/skills", label: "Skills", icon: BookOpenCheck, keywords: "library reference videos steps" },
  { href: "/dashboard/verified", label: "Verified skills", icon: BadgeCheck, keywords: "approved competencies" },
  {
    href: "/dashboard/safety",
    label: "Safety reports",
    icon: ShieldAlert,
    badge: "safety",
    keywords: "flags movement data balance",
  },
];

export const settingsNav: NavItem = {
  href: "/dashboard/settings",
  label: "Settings",
  icon: Settings,
  keywords: "profile agency notifications account system",
};

/** Every page the search box can jump to: the sidebar, plus pages reached from inside one. */
export const searchablePages: NavItem[] = [
  ...primaryNav,
  { href: "/dashboard/skills/new", label: "New skill", icon: Plus, keywords: "record upload reference video add create" },
  settingsNav,
];
