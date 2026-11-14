"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type RailItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown next to the label when above zero, e.g. how many reviews are waiting. */
  count?: number;
  /** Other routes that belong to this item, e.g. a review opened from the pending list. */
  also?: string[];
  /** Active only on exactly this route, not the pages under it (a portal's home page). */
  exact?: boolean;
};

function under(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isActive(pathname: string, item: RailItem) {
  if (item.exact) return pathname === item.href;
  return under(pathname, item.href) || (item.also ?? []).some((href) => under(pathname, href));
}

function itemClass(active: boolean) {
  return cn(
    "relative flex h-11 items-center gap-3 rounded-[12px] px-3 text-sm font-medium transition-colors",
    active ? "bg-teal-soft text-teal" : "text-navy hover:bg-secondary",
  );
}

/**
 * The navigation down the left side of the dashboard and of the caregiver portal: the
 * main pages at the top and one item (settings or profile) at the bottom. Below the
 * `lg` width it shows icons only.
 */
export function Rail({ label, items, footer }: { label: string; items: RailItem[]; footer?: RailItem }) {
  const pathname = usePathname();
  const footerActive = footer ? isActive(pathname, footer) : false;
  const FooterIcon = footer?.icon;

  return (
    <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto text-navy">
      <nav className="flex flex-1 flex-col gap-1 px-2 pt-2" aria-label={label}>
        {items.map((item) => {
          const active = isActive(pathname, item);
          const count = item.count ?? 0;
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

      {footer && FooterIcon ? (
        <div className="border-t border-border px-2 py-3">
          <Link
            href={footer.href}
            title={footer.label}
            aria-current={footerActive ? "page" : undefined}
            className={itemClass(footerActive)}
          >
            <FooterIcon className="h-[18px] w-[18px] shrink-0" />
            <span className="hidden lg:inline">{footer.label}</span>
          </Link>
        </div>
      ) : null}
    </aside>
  );
}
