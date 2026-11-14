"use client";

import type { ReactNode } from "react";
import { ErrorNote } from "@/components/ui";
import { cn } from "@/lib/cn";
import { RAIL_WIDTH, SCREEN_CORNER, SCREEN_INSET } from "@/nurse/components/layout/chrome";
import { Sidebar } from "@/nurse/components/layout/Sidebar";
import { TopNav } from "@/nurse/components/layout/TopNav";
import { useDashboard } from "@/nurse/context/DashboardContext";
import { Logo } from "@/shared/Logo";
import { PageTransition } from "@/shared/PageTransition";
import { useHomeLink } from "@/shared/RefreshBoundary";

export function AppShell({ children }: { children: ReactNode }) {
  const { flash, clearFlash, overview, overviewError, reloadOverview } = useDashboard();
  // On the overview itself the brand link has nowhere to go, so it refreshes the page.
  const brand = useHomeLink("/dashboard");

  return (
    <div className="flex min-h-screen bg-white">
      <div className={cn("sticky top-0 flex h-dvh shrink-0 flex-col bg-white", RAIL_WIDTH)}>
        <div className="flex h-16 shrink-0 items-center justify-center lg:justify-start lg:px-4">
          <Logo href="/dashboard" nameClassName="hidden lg:inline" onClick={brand.onClick} />
        </div>
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <TopNav />
        {overviewError && !overview ? (
          <div className="border-b border-danger/20 bg-danger-bg px-4 py-2 md:px-6 lg:px-8">
            <ErrorNote
              message={`Counts and notifications could not be loaded. ${overviewError}`}
              onRetry={reloadOverview}
              className="border-0 bg-transparent px-0 py-0"
            />
          </div>
        ) : null}
        {flash ? (
          <div
            role="status"
            className={cn(
              "flex items-center justify-between gap-3 border-b px-6 py-2.5 text-sm",
              flash.tone === "success" && "border-success/20 bg-success-bg text-success",
              flash.tone === "danger" && "border-danger/20 bg-danger-bg text-danger",
              flash.tone === "info" && "border-info/20 bg-info-bg text-info",
            )}
          >
            <p>{flash.message}</p>
            <button type="button" onClick={clearFlash} className="text-xs font-medium underline">
              Dismiss
            </button>
          </div>
        ) : null}
        <main
          id="main"
          className={cn("min-h-0 flex-1 bg-page py-6 pr-4 md:pr-6 lg:pr-8", SCREEN_CORNER, SCREEN_INSET)}
        >
          {/* The one column every page sits in, so each page's content starts and stops in the same place. */}
          <PageTransition className="mx-auto w-full max-w-[1400px]">{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
