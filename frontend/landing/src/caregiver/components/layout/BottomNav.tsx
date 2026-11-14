"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRound, Home, ListChecks } from "lucide-react";
import { cn } from "@/caregiver/lib/cn";

const items = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/skills", label: "My Skills", icon: ListChecks },
  { href: "/portal/profile", label: "Profile", icon: CircleUserRound },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur-sm md:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5">
        {items.map((item) => {
          const active =
            item.href === "/portal"
              ? pathname === "/portal"
              : pathname.startsWith(item.href);
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
                <Icon
                  className={cn("h-5 w-5", active ? "stroke-[2.2]" : "stroke-[1.75]")}
                  aria-hidden
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
