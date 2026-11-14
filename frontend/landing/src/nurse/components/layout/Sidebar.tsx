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

export function Sidebar() {
  const pathname = usePathname();
  const { overview } = useDashboard();
  const counts = {
    pending: overview?.counts.pending ?? 0,
    safety: overview?.counts.safety_flags ?? 0,
  };
  const settingsActive = under(pathname, "/dashboard/settings");

  return (
    <aside className="flex h-full w-[72px] shrink-0 flex-col overflow-y-auto bg-navy text-white lg:w-[248px]">
      <nav className="mt-3 flex flex-1 flex-col gap-1 px-2" aria-label="Clinical">
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
              className={cn(
                "group relative flex h-11 items-center gap-3 rounded-[12px] px-3 text-sm transition-colors",
                active ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
              )}
            >
              {active ? <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-teal" /> : null}
              <span className="relative">
                <Icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-teal")} />
                {count > 0 ? (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-teal ring-2 ring-navy lg:hidden" aria-hidden />
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

      <div className="px-2 pb-4">
        <Link
          href="/dashboard/settings"
          title="Settings"
          aria-current={settingsActive ? "page" : undefined}
          className={cn(
            "relative flex h-11 items-center gap-3 rounded-[12px] px-3 text-sm transition-colors",
            settingsActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
          )}
        >
          {settingsActive ? <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-teal" /> : null}
          <Settings className={cn("h-[18px] w-[18px] shrink-0", settingsActive && "text-teal")} />
          <span className="hidden lg:inline">Settings</span>
        </Link>
      </div>
    </aside>
  );
}
