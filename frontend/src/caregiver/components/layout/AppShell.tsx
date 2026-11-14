"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BottomNav } from "@/caregiver/components/layout/BottomNav";
import { mainNav, profileNav } from "@/caregiver/nav";
import { cn } from "@/lib/cn";
import { AccountMenu } from "@/shared/layout/AccountMenu";
import { Rail } from "@/shared/layout/Rail";
import { Logo } from "@/shared/Logo";
import { RailBrand } from "@/shared/layout/RailBrand";
import { PageTransition } from "@/shared/PageTransition";
import { useHomeLink } from "@/shared/RefreshBoundary";
import { LivelyBackground } from "@/shared/LivelyBackground";

/** On a phone, practising a skill and reading a result take the whole screen, without the bottom nav. */
function isImmersivePath(pathname: string) {
  return /\/skills\/[^/]+/.test(pathname);
}

/**
 * The frame around every portal page.
 *
 * Phone and tablet: the brand and the account menu (profile, sign out) at the top, the
 * pages along the bottom, and one narrow column of content.
 *
 * Laptop and wider (the `lg` width): the same frame as the nurse dashboard. A sidebar
 * with the brand and organisation, the pages, and the account menu at the bottom, and the
 * page in a wide column beside it. No top bar. The sizes match nurse/components/layout/AppShell.tsx and
 * shared/layout/chrome.ts.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const immersive = isImmersivePath(pathname);
  // On the home page itself the brand link has nowhere to go, so it refreshes the page.
  const brand = useHomeLink("/portal");

  return (
    <div className="min-h-dvh w-full bg-page lg:flex">
      <div className="chrome-rail sticky top-0 z-40 hidden h-dvh w-[248px] shrink-0 flex-col lg:flex">
        <RailBrand href="/portal" onClick={brand.onClick} />
        <Rail label="Main" items={mainNav} footer={profileNav} />
        <div className="border-t border-border px-2 py-3">
          <AccountMenu links={[profileNav]} role="Caregiver" inRail />
        </div>
      </div>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="chrome-bar sticky top-0 z-30 w-full border-b border-border lg:hidden">
          <div className="flex h-16 w-full items-center justify-between gap-3 px-4 sm:px-6">
            <Logo href="/portal" light onClick={brand.onClick} />
            <AccountMenu links={[profileNav]} role="Caregiver" />
          </div>
        </header>


        <main
          id="main"
          className={cn(
            "relative isolate w-full flex-1 px-4",
            immersive ? "pb-8 pt-5" : "pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6",
            "lg:bg-page lg:pb-6 lg:pl-8 lg:pr-8 lg:pt-6",
          )}
        >
          <LivelyBackground belowMobileHeader />
          {/* One narrow column on a phone; on a laptop the same wide column as the dashboard. */}
          <PageTransition className="mx-auto w-full max-w-lg md:max-w-2xl lg:max-w-[1400px]">{children}</PageTransition>
        </main>
      </div>

      {immersive ? null : <BottomNav />}
    </div>
  );
}
