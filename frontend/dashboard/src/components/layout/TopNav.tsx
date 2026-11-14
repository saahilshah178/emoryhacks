"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { useDashboard } from "@/context/DashboardContext";
import { CURRENT_NURSE, notifications } from "@/lib/mock-data";
import { cn } from "@/lib/cn";

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
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((item) => item.unread).length;
  const title = pathname.startsWith("/reviews/")
    ? "Skill Review"
    : (titles[pathname] ?? "Clinical Dashboard");

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-white px-4 md:px-6">
      <div className="shrink-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">
          Nurse workspace
        </p>
        <h1 className="text-lg font-semibold text-navy">{title}</h1>
      </div>

      <label className="relative ml-auto hidden w-64 lg:w-96 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search caregivers, skills, or submissions"
          className="h-10 w-full rounded-[12px] border border-border bg-secondary pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-teal focus:bg-white focus:ring-2 focus:ring-teal/20"
        />
      </label>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="relative flex h-10 w-10 items-center justify-center rounded-[12px] border border-border text-ink-secondary hover:bg-secondary"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger" />
          )}
        </button>
        {open && (
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
                    onClick={() => setOpen(false)}
                    className={cn(
                      "block px-4 py-3 hover:bg-secondary",
                      item.unread && "bg-teal-soft/40",
                    )}
                  >
                    <p className="text-sm font-medium text-ink">{item.title}</p>
                    <p className="mt-0.5 text-xs text-ink-secondary">{item.body}</p>
                    <p className="mt-1 text-[11px] text-ink-muted">{item.relativeLabel}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="hidden items-center gap-3 pl-1 md:flex">
        <div className="text-right">
          <p className="text-sm font-medium text-ink">{CURRENT_NURSE.name}</p>
          <p className="text-xs text-ink-secondary">{CURRENT_NURSE.credentials}</p>
        </div>
        <Avatar name={CURRENT_NURSE.name} initials="PC" />
      </div>
    </header>
  );
}
