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
import { APP_NAME } from "@/lib/branding";
import { cn } from "@/lib/cn";
import { useDashboard } from "@/context/DashboardContext";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/pending", label: "Pending Reviews", icon: ClipboardList, badge: "pending" as const },
  { href: "/caregivers", label: "Caregivers", icon: Users },
  { href: "/verified", label: "Verified Skills", icon: BadgeCheck },
  { href: "/safety", label: "Safety Reports", icon: ShieldAlert, badge: "safety" as const },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/pending") return pathname === "/pending" || pathname.startsWith("/reviews");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const { pendingCount, safetyFlagCount } = useDashboard();

  return (
    <aside className="flex h-full w-[72px] shrink-0 flex-col bg-navy text-white lg:w-[248px]">
      <div className="flex h-16 items-center gap-3 px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-teal text-sm font-semibold">
          {APP_NAME.charAt(0)}
        </span>
        <div className="hidden min-w-0 lg:block">
          <p className="truncate text-sm font-semibold tracking-tight">{APP_NAME}</p>
          <p className="text-[11px] text-white/55">Clinical operations</p>
        </div>
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-1 px-2">
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
          href="/settings"
          className={cn(
            "flex h-11 items-center gap-3 rounded-[12px] px-3 text-sm transition-colors",
            pathname === "/settings"
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
