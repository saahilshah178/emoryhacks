"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { SEARCH_ALIGN } from "@/shared/layout/chrome";
import { GlobalSearch } from "@/nurse/components/layout/GlobalSearch";
import { useDashboard } from "@/nurse/context/DashboardContext";
import { settingsNav } from "@/nurse/nav";
import { AccountMenu } from "@/shared/layout/AccountMenu";

export function TopNav() {
  const { overview, reloadOverview } = useDashboard();
  const [open, setOpen] = useState(false);
  // Which items were unread when the menu was opened: they stay highlighted while it is open,
  // even though opening it marks them as seen.
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const notificationsRef = useRef<HTMLDivElement>(null);
  const notificationsMenuId = useId();

  const notifications = overview?.notifications ?? [];
  const unread = overview?.unread ?? 0;

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!notificationsRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function toggleNotifications() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
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
      <GlobalSearch className="hidden min-w-0 max-w-2xl flex-1 sm:block" onOpen={() => setOpen(false)} />

      <div className="relative ml-auto" ref={notificationsRef}>
        <button
          type="button"
          onClick={toggleNotifications}
          className="relative flex h-10 min-w-10 items-center justify-center rounded-[12px] border border-border px-2 text-ink-secondary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          aria-expanded={open}
          aria-haspopup="true"
          aria-controls={notificationsMenuId}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 ? <span className="ml-1 text-xs font-semibold text-danger">{unread}</span> : null}
        </button>
        {open ? (
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
                  <Link href="/dashboard/settings" onClick={() => setOpen(false)} className="font-medium text-teal hover:underline">
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
                      onClick={() => setOpen(false)}
                      className={cn(
                        "block px-4 py-3 hover:bg-secondary",
                        freshIds.has(item.id) && "bg-teal-soft/40",
                        item.forced && "border-l-2 border-warning",
                      )}
                    >
                      <p className="text-sm font-medium text-ink">{item.title}</p>
                      {item.forced ? (
                        <Badge tone="warning" className="mt-1">
                          Sent anyway
                        </Badge>
                      ) : null}
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

      <AccountMenu links={[settingsNav]} role="Nurse" onOpen={() => setOpen(false)} />
    </header>
  );
}
