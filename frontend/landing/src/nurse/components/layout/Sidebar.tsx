"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  ClipboardList,
  LayoutDashboard,
  Settings,
  ShieldAlert,
  Users,
} from "lucide-react";
import { cn } from "@/nurse/lib/cn";
import { useDashboard } from "@/nurse/context/DashboardContext";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/pending", label: "Pending Reviews", icon: ClipboardList, badge: "pending" as const },
  { href: "/dashboard/caregivers", label: "Caregivers", icon: Users },
  { href: "/dashboard/verified", label: "Verified Skills", icon: BadgeCheck },
  { href: "/dashboard/safety", label: "Safety Reports", icon: ShieldAlert, badge: "safety" as const },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/dashboard/pending") return pathname === "/dashboard/pending" || pathname.startsWith("/dashboard/reviews");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const { pendingCount, safetyFlagCount } = useDashboard();

  return (
    <aside className="flex h-full w-[72px] shrink-0 flex-col overflow-y-auto bg-navy text-white lg:w-[248px]">
      <nav className="mt-3 flex flex-1 flex-col gap-1 px-2" aria-label="Clinical">
        {nav.map((item) => {
          const active = isActive(pathname, item.href);
          const count =
            item.badge === "pending"
              ? pendingCount
              : item.badge === "safety"
                ? safetyFlagCount
                : 0;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex h-11 items-center gap-3 rounded-[12px] px-3 text-sm transition-colors",
                active
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:bg-white/5 hover:text-white",
              )}
            >
              {active && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-teal" />
              )}
              <Icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-teal")} />
              <span className="hidden truncate lg:inline">{item.label}</span>
              {count > 0 && (
                <span className="ml-auto hidden min-w-5 rounded-full bg-teal px-1.5 text-center text-[11px] font-semibold text-white lg:inline">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-2 pb-4">
        <Link
          href="/dashboard/settings"
          className={cn(
            "flex h-11 items-center gap-3 rounded-[12px] px-3 text-sm transition-colors",
            pathname === "/dashboard/settings"
              ? "bg-white/10 text-white"
              : "text-white/70 hover:bg-white/5 hover:text-white",
          )}
        >
          <Settings className="h-[18px] w-[18px]" />
          <span className="hidden lg:inline">Settings</span>
        </Link>
      </div>
    </aside>
  );
}
