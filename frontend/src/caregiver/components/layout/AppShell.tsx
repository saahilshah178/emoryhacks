"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AvatarButton } from "@/caregiver/components/layout/AvatarButton";
import { BottomNav } from "@/caregiver/components/layout/BottomNav";
import { mainNav, profileNav } from "@/caregiver/nav";
import { cn } from "@/lib/cn";
import { useUser } from "@/shared/AuthProvider";
import { AccountMenu } from "@/shared/layout/AccountMenu";
import { Rail } from "@/shared/layout/Rail";
import { Logo } from "@/shared/Logo";
import { PageTransition } from "@/shared/PageTransition";
import { useHomeLink } from "@/shared/RefreshBoundary";

/** On a phone, practising a skill and reading a result take the whole screen, without the bottom nav. */
function isImmersivePath(pathname: string) {
  return /\/skills\/[^/]+/.test(pathname);
}

/**
 * The frame around every portal page.
 *
 * Phone and tablet: the brand and the profile at the top, the pages along the bottom, and
 * one narrow column of content.
 *
 * Laptop and wider (the `lg` width): the same frame as the nurse dashboard. A white rail
 * with the brand and the pages, a top bar with the account menu, and the page in a wide
 * column on the grey canvas. The sizes match nurse/components/layout/AppShell.tsx and
 * shared/layout/chrome.ts.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const user = useUser();
  const immersive = isImmersivePath(pathname);
  // On the home page itself the brand link has nowhere to go, so it refreshes the page.
  const brand = useHomeLink("/portal");

  return (
    <div className="min-h-dvh w-full bg-page lg:flex lg:bg-white">
      <div className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col bg-white lg:flex">
        <div className="flex h-16 shrink-0 items-center px-4">
          <Logo href="/portal" onClick={brand.onClick} />
        </div>
        <Rail label="Main" items={mainNav} footer={profileNav} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 w-full border-b border-border bg-white lg:hidden">
          <div className="flex h-16 w-full items-center justify-between gap-3 px-4 sm:px-6">
            <Logo href="/portal" onClick={brand.onClick} />
            <AvatarButton />
          </div>
        </header>

        <header className="sticky top-0 z-30 hidden h-16 shrink-0 items-center gap-4 bg-white pl-8 pr-6 lg:flex">
          <p className="min-w-0 truncate text-sm text-ink-secondary">{user.org.name}</p>
          <div className="ml-auto">
            <AccountMenu links={[profileNav]} role="Caregiver" />
          </div>
        </header>

        <main
          id="main"
          className={cn(
            "w-full flex-1 px-4",
            immersive ? "pb-8 pt-5" : "pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6",
            "lg:rounded-tl-[1.25rem] lg:bg-page lg:pb-6 lg:pl-8 lg:pr-8 lg:pt-6",
          )}
        >
          {/* One narrow column on a phone; on a laptop the same wide column as the dashboard. */}
          <PageTransition className="mx-auto w-full max-w-lg md:max-w-2xl lg:max-w-[1400px]">{children}</PageTransition>
        </main>
      </div>

      {immersive ? null : <BottomNav />}
    </div>
  );
}
