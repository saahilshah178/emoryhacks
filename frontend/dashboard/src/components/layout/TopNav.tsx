"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronDown, LogOut, Search, Settings } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Logo } from "@/components/layout/Logo";
import { Avatar } from "@/components/ui/Avatar";
import { useDashboard } from "@/context/DashboardContext";
import { CURRENT_NURSE, notifications } from "@/lib/mock-data";
import { cn } from "@/lib/cn";
import { useAuth } from "@/shared/AuthProvider";

const titles: Record<string, string> = {
  "/": "Clinical Dashboard",
  "/pending": "Pending Reviews",
  "/caregivers": "Caregivers",
  "/verified": "Verified Skills",
  "/safety": "Safety Reports",
  "/settings": "Settings",
};

export function TopNav() {
  const pathname = usePathname();
  const { search, setSearch } = useDashboard();
  const { signOut } = useAuth();
  const [menu, setMenu] = useState<"notifications" | "account" | null>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountMenuId = useId();
  const unread = notifications.filter((item) => item.unread).length;
  const onReview = pathname.startsWith("/reviews/");
  const title = onReview ? "Skill Review" : (titles[pathname] ?? "Clinical Dashboard");

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      const insideNotifications = notificationsRef.current?.contains(target);
      const insideAccount = accountRef.current?.contains(target);
      if (!insideNotifications && !insideAccount) setMenu(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b border-border bg-white px-6">
      <Logo />
      <span className="hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden />
      <h1 className="min-w-0 truncate text-lg font-semibold text-navy">{title}</h1>

      {!onReview ? (
        <label className="relative ml-auto hidden w-64 lg:w-96 sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search caregivers, skills, or submissions"
            className="h-10 w-full rounded-[12px] border border-border bg-secondary pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-secondary focus:border-teal focus:bg-white focus:ring-2 focus:ring-teal/20"
          />
        </label>
      ) : null}

      <div className={cn("relative", onReview ? "ml-auto" : "ml-auto sm:ml-0")} ref={notificationsRef}>
        <button
          type="button"
          onClick={() =>
            setMenu((current) => (current === "notifications" ? null : "notifications"))
          }
          className="relative flex h-10 min-w-10 items-center justify-center rounded-[12px] border border-border px-2 text-ink-secondary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          aria-expanded={menu === "notifications"}
          aria-haspopup="menu"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="ml-1 text-xs font-semibold text-danger">{unread}</span>
          )}
        </button>
        {menu === "notifications" && (
          <div className="absolute right-0 z-30 mt-2 w-[340px] overflow-hidden rounded-[12px] border border-border bg-white shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-ink">Notifications</p>
              <span className="text-xs text-ink-secondary">{unread} unread</span>
            </div>
            <ul className="max-h-80 overflow-auto">
              {notifications.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href ?? "/pending"}
                    onClick={() => setMenu(null)}
                    className={cn(
                      "block px-4 py-3 hover:bg-secondary",
                      item.unread && "bg-teal-soft/40",
                    )}
                  >
                    <p className="text-sm font-medium text-ink">{item.title}</p>
                    <p className="mt-0.5 text-xs text-ink-secondary">{item.body}</p>
                    <p className="mt-1 text-[11px] text-ink-secondary">{item.relativeLabel}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="relative" ref={accountRef}>
        <button
          type="button"
          aria-label="Account menu"
          aria-expanded={menu === "account"}
          aria-haspopup="menu"
          aria-controls={accountMenuId}
          onClick={() => setMenu((current) => (current === "account" ? null : "account"))}
          className="flex shrink-0 items-center gap-2.5 rounded-[12px] p-1 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30 md:pr-2"
        >
          <span className="hidden text-right md:block">
            <span className="block whitespace-nowrap text-sm font-medium text-ink">
              {CURRENT_NURSE.name}
            </span>
            <span className="block whitespace-nowrap text-xs text-ink-secondary">
              {CURRENT_NURSE.credentials}
            </span>
          </span>
          <Avatar name={CURRENT_NURSE.name} initials="PC" />
          <ChevronDown
            className={cn(
              "hidden h-4 w-4 shrink-0 text-ink-secondary transition-transform duration-150 md:block",
              menu === "account" && "rotate-180",
            )}
          />
        </button>
        {menu === "account" && (
          <div
            id={accountMenuId}
            role="menu"
            aria-label="Account"
            className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-[12px] border border-border bg-white shadow-[var(--shadow-card)]"
          >
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-ink">{CURRENT_NURSE.name}</p>
              <p className="text-xs text-ink-secondary">
                {CURRENT_NURSE.credentials} · {CURRENT_NURSE.title}
              </p>
              <p className="mt-0.5 truncate text-xs text-ink-secondary">{CURRENT_NURSE.email}</p>
            </div>
            <Link
              role="menuitem"
              href="/settings"
              onClick={() => setMenu(null)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
            >
              <Settings className="h-4 w-4 text-ink-secondary" />
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
            >
              <LogOut className="h-4 w-4 text-ink-secondary" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
