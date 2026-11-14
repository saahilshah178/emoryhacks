"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { bottomNav } from "@/caregiver/nav";
import { cn } from "@/lib/cn";

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname.startsWith(href);
}

/** The portal's pages along the bottom of a phone or tablet. A laptop has the rail instead. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white/95 backdrop-blur-sm lg:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5">
        {bottomNav.map((item) => {
          const active = isActive(pathname, item.href, item.exact);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[12px] px-2 text-[11px] font-medium",
                  active ? "bg-teal-soft text-teal" : "text-ink-secondary",
                )}
              >
                <Icon className={cn("h-5 w-5", active ? "stroke-[2.2]" : "stroke-[1.75]")} aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
