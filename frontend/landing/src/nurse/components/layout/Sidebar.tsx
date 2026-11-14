"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  BookOpenCheck,
  ClipboardList,
  LayoutDashboard,
  Settings,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useDashboard } from "@/nurse/context/DashboardContext";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "pending" | "safety";
  /** Other routes that belong to this item, e.g. a review opened from the pending list. */
  also?: string[];
};

const nav: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/pending", label: "Pending reviews", icon: ClipboardList, badge: "pending", also: ["/dashboard/reviews"] },
  { href: "/dashboard/caregivers", label: "Caregivers", icon: Users },
  { href: "/dashboard/skills", label: "Skills", icon: BookOpenCheck },
  { href: "/dashboard/verified", label: "Verified skills", icon: BadgeCheck },
  { href: "/dashboard/safety", label: "Safety reports", icon: ShieldAlert, badge: "safety" },
];

function under(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isActive(pathname: string, item: NavItem) {
  if (item.href === "/dashboard") return pathname === "/dashboard";
  return under(pathname, item.href) || (item.also ?? []).some((href) => under(pathname, href));
}

function itemClass(active: boolean) {
  return cn(
    "relative flex h-11 items-center gap-3 rounded-[12px] px-3 text-sm font-medium transition-colors",
    active ? "bg-teal-soft text-teal" : "text-navy hover:bg-secondary",
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { overview } = useDashboard();
  const counts = {
    pending: overview?.counts.pending ?? 0,
    safety: overview?.counts.safety_flags ?? 0,
  };
  const settingsActive = under(pathname, "/dashboard/settings");

  return (
    <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto text-navy">
      <nav className="flex flex-1 flex-col gap-1 px-2 pt-2" aria-label="Clinical">
        {nav.map((item) => {
          const active = isActive(pathname, item);
          const count = item.badge ? counts[item.badge] : 0;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-current={active ? "page" : undefined}
              aria-label={count > 0 ? `${item.label}, ${count}` : item.label}
              className={itemClass(active)}
            >
              <span className="relative">
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {count > 0 ? (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-teal ring-2 ring-white lg:hidden" aria-hidden />
                ) : null}
              </span>
              <span className="hidden truncate lg:inline">{item.label}</span>
              {count > 0 ? (
                <span className="ml-auto hidden min-w-5 rounded-full bg-teal px-1.5 text-center text-[11px] font-semibold text-white lg:inline">
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-2 py-3">
        <Link
          href="/dashboard/settings"
          title="Settings"
          aria-current={settingsActive ? "page" : undefined}
          className={itemClass(settingsActive)}
        >
          <Settings className="h-[18px] w-[18px] shrink-0" />
          <span className="hidden lg:inline">Settings</span>
        </Link>
      </div>
    </aside>
  );
}
