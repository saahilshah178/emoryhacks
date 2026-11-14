"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AvatarButton } from "@/caregiver/components/layout/AvatarButton";
import { BottomNav, navItems, isActive } from "@/caregiver/components/layout/BottomNav";
import { cn } from "@/lib/cn";
import { Logo } from "@/shared/Logo";
import { PageTransition } from "@/shared/PageTransition";
import { useHomeLink } from "@/shared/RefreshBoundary";

/** Practising a skill and reading a result take the whole screen, without the bottom nav. */
function isImmersivePath(pathname: string) {
  return /\/skills\/[^/]+/.test(pathname);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const immersive = isImmersivePath(pathname);
  // On the home page itself the brand link has nowhere to go, so it refreshes the page.
  const brand = useHomeLink("/portal");

  return (
    <div className="min-h-dvh w-full bg-page">
      <header className="sticky top-0 z-30 w-full border-b border-border bg-white">
        <div className="flex h-16 w-full items-center justify-between gap-3 px-4 sm:px-6">
          <Logo href="/portal" onClick={brand.onClick} />
          {!immersive ? (
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className={cn(
                    "rounded-[12px] px-3 py-2 text-sm font-medium transition-colors",
                    isActive(pathname, item.href) ? "bg-teal-soft text-teal" : "text-navy hover:bg-secondary",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          ) : null}
          <AvatarButton />
        </div>
      </header>

      <main
        id="main"
        className={cn(
          "mx-auto w-full max-w-lg px-4 md:max-w-3xl",
          immersive ? "pb-8 pt-5 md:pb-12" : "pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6 md:pb-12",
        )}
      >
        <PageTransition>{children}</PageTransition>
      </main>

      {immersive ? null : <BottomNav />}
    </div>
  );
}
