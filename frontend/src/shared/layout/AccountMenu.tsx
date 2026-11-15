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
 * The signed-in person: name, role and avatar, opening a menu with who they are, the
 * given links and "Sign out". In a top bar it sits at the right and opens downward; at
 * the bottom of a sidebar (`inRail`) it fills the width and opens upward. Below the `lg`
 * width the sidebar version shows the avatar only.
 */
export function AccountMenu({
  links,
  role,
  onOpen,
  inRail = false,
}: {
  links: AccountLink[];
  /** Shown under the name when the account has no credentials or job title. */
  role: string;
  /** Called when the menu opens, so a neighbouring menu can close. */
  onOpen?: () => void;
  /** At the bottom of a sidebar instead of the right of a top bar. */
  inRail?: boolean;
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
      className={cn("relative", inRail && "w-full")}
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
        className={cn(
          "flex shrink-0 items-center gap-2.5 rounded-[12px] py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30",
          inRail
            ? "w-full justify-center px-1.5 py-1.5 hover:bg-white/10 lg:justify-start"
            : "pl-3 pr-1 hover:bg-white/10 md:pr-2",
        )}
      >
        <span
          className={cn(
            "max-w-[180px]",
            inRail ? "order-2 hidden min-w-0 flex-1 text-left lg:block" : "hidden text-right md:block",
          )}
        >
          <span className="block truncate text-sm font-medium text-white">{user.name}</span>
          <span className="block truncate text-xs text-white/65">{user.credentials || user.title || role}</span>
        </span>
        <span className={cn(inRail && "order-1")}>
          <Avatar name={user.name} />
        </span>
        <ChevronDown
          className={cn(
            "hidden h-4 w-4 shrink-0 text-white/65 transition-transform duration-150",
            inRail ? "order-3 rotate-180 lg:block" : "md:block",
            open && (inRail ? "rotate-0" : "rotate-180"),
          )}
        />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className={cn(
            "absolute z-50 w-64 overflow-hidden rounded-[12px] border border-border bg-white shadow-[var(--shadow-card)]",
            inRail ? "bottom-full left-0 mb-2" : "right-0 mt-2",
          )}
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
