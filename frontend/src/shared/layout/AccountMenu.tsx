"use client";

import Link from "next/link";
import { ChevronDown, LogOut, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAuth, useUser } from "@/shared/AuthProvider";
import { agencyCaption } from "@/shared/JoinAgency";

export type AccountLink = { href: string; label: string; icon: LucideIcon };

/**
 * The signed-in person at the right of a top bar: name, role and avatar, opening a menu
 * with who they are, the given links and "Sign out".
 */
export function AccountMenu({
  links,
  role,
  onOpen,
}: {
  links: AccountLink[];
  /** Shown under the name when the account has no credentials or job title. */
  role: string;
  /** Called when the menu opens, so a neighbouring menu can close. */
  onOpen?: () => void;
}) {
  const { signOut } = useAuth();
  const user = useUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const roleLine = [user.credentials, user.title].filter(Boolean).join(" · ") || role;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
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
  }, [open]);

  function toggle() {
    if (!open) onOpen?.();
    setOpen(!open);
  }

  return (
    <div
      className="relative"
      ref={ref}
      onBlur={(event) => {
        // Tabbing out of the menu closes it.
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        className="flex shrink-0 items-center gap-2.5 rounded-[12px] py-1 pl-3 pr-1 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30 md:pr-2"
      >
        <span className="hidden max-w-[180px] text-right md:block">
          <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
          <span className="block truncate text-xs text-ink-secondary">{user.credentials || user.title || role}</span>
        </span>
        <Avatar name={user.name} />
        <ChevronDown
          className={cn(
            "hidden h-4 w-4 shrink-0 text-ink-secondary transition-transform duration-150 md:block",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-[12px] border border-border bg-white shadow-[var(--shadow-card)]"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
            <p className="text-xs text-ink-secondary">{roleLine}</p>
            <p className="mt-0.5 truncate text-xs text-ink-secondary">{user.email}</p>
            <p className="mt-0.5 truncate text-xs text-ink-secondary">{agencyCaption(user)}</p>
          </div>
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              role="menuitem"
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
            >
              <Icon className="h-4 w-4 text-ink-secondary" />
              {label}
            </Link>
          ))}
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
  );
}
