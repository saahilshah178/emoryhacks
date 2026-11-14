"use client";

import Link from "next/link";
import { Bell, ChevronDown, LogOut, Settings } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { SEARCH_ALIGN } from "@/nurse/components/layout/chrome";
import { GlobalSearch } from "@/nurse/components/layout/GlobalSearch";
import { useDashboard } from "@/nurse/context/DashboardContext";
import { useAuth, useUser } from "@/shared/AuthProvider";

export function TopNav() {
  const { overview, reloadOverview } = useDashboard();
  const { signOut } = useAuth();
  const user = useUser();
  const [menu, setMenu] = useState<"notifications" | "account" | null>(null);
  // Which items were unread when the menu was opened: they stay highlighted while it is open,
  // even though opening it marks them as seen.
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const notificationsRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountMenuId = useId();
  const notificationsMenuId = useId();

  const notifications = overview?.notifications ?? [];
  const unread = overview?.unread ?? 0;
  const roleLine = [user.credentials, user.title].filter(Boolean).join(" · ") || "Nurse";

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

  function toggleNotifications() {
    if (menu === "notifications") {
      setMenu(null);
      return;
    }
    setMenu("notifications");
    setFreshIds(new Set(notifications.filter((item) => item.unread).map((item) => item.id)));
    if (unread > 0) {
      api("/notifications/seen", { method: "POST" })
        .then(() => reloadOverview())
        .catch(() => {
          // Marking as seen is a convenience; the items are still listed if it fails.
        });
    }
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 bg-white pr-4 md:pr-6",
        SEARCH_ALIGN,
      )}
    >
      <GlobalSearch className="hidden min-w-0 max-w-2xl flex-1 sm:block" onOpen={() => setMenu(null)} />

      <div className="relative ml-auto" ref={notificationsRef}>
        <button
          type="button"
          onClick={toggleNotifications}
          className="relative flex h-10 min-w-10 items-center justify-center rounded-[12px] border border-border px-2 text-ink-secondary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          aria-expanded={menu === "notifications"}
          aria-haspopup="true"
          aria-controls={notificationsMenuId}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 ? <span className="ml-1 text-xs font-semibold text-danger">{unread}</span> : null}
        </button>
        {menu === "notifications" ? (
          <div
            id={notificationsMenuId}
            className="absolute right-0 z-30 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[12px] border border-border bg-white shadow-[var(--shadow-card)]"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-ink">Notifications</p>
              <span className="text-xs text-ink-secondary">
                {freshIds.size > 0 ? `${freshIds.size} new` : "All caught up"}
              </span>
            </div>
            {notifications.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm font-medium text-ink">Nothing needs you right now</p>
                <p className="mt-1 text-xs text-ink-secondary">
                  New submissions and safety concerns waiting for review appear here. Choose which ones in{" "}
                  <Link href="/dashboard/settings" onClick={() => setMenu(null)} className="font-medium text-teal hover:underline">
                    Settings
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <ul className="max-h-80 overflow-auto">
                {notifications.map((item) => (
                  <li key={item.id} className="border-b border-border last:border-b-0">
                    <Link
                      href={item.attempt_id ? `/dashboard/reviews/${item.attempt_id}` : "/dashboard/pending"}
                      onClick={() => setMenu(null)}
                      className={cn("block px-4 py-3 hover:bg-secondary", freshIds.has(item.id) && "bg-teal-soft/40")}
                    >
                      <p className="text-sm font-medium text-ink">{item.title}</p>
                      <p className="mt-0.5 text-xs text-ink-secondary">{item.body}</p>
                      <p className="mt-1 text-[11px] text-ink-secondary">{relativeTime(item.time)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <div className="relative" ref={accountRef}>
        <button
          type="button"
          aria-label="Account menu"
          aria-expanded={menu === "account"}
          aria-haspopup="menu"
          aria-controls={accountMenuId}
          onClick={() => setMenu((current) => (current === "account" ? null : "account"))}
          className="flex shrink-0 items-center gap-2.5 rounded-[12px] py-1 pl-3 pr-1 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30 md:pr-2"
        >
          <span className="hidden max-w-[180px] text-right md:block">
            <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
            <span className="block truncate text-xs text-ink-secondary">{user.credentials || user.title || "Nurse"}</span>
          </span>
          <Avatar name={user.name} />
          <ChevronDown
            className={cn(
              "hidden h-4 w-4 shrink-0 text-ink-secondary transition-transform duration-150 md:block",
              menu === "account" && "rotate-180",
            )}
          />
        </button>
        {menu === "account" ? (
          <div
            id={accountMenuId}
            role="menu"
            aria-label="Account"
            className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-[12px] border border-border bg-white shadow-[var(--shadow-card)]"
          >
            <div className="border-b border-border px-4 py-3">
              <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
              <p className="text-xs text-ink-secondary">{roleLine}</p>
              <p className="mt-0.5 truncate text-xs text-ink-secondary">{user.email}</p>
              <p className="mt-0.5 truncate text-xs text-ink-secondary">{user.org.name}</p>
            </div>
            <Link
              role="menuitem"
              href="/dashboard/settings"
              onClick={() => setMenu(null)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
            >
              <Settings className="h-4 w-4 text-ink-secondary" />
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
            >
              <LogOut className="h-4 w-4 text-ink-secondary" />
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
