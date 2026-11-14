"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ErrorNote } from "@/components/ui";
import { cn } from "@/lib/cn";
import { Sidebar } from "@/nurse/components/layout/Sidebar";
import { TopNav } from "@/nurse/components/layout/TopNav";
import { useDashboard } from "@/nurse/context/DashboardContext";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { flash, clearFlash, setSearch, overview, overviewError, reloadOverview } = useDashboard();

  // The search box filters the page it is on, so a new page starts with it empty.
  useEffect(() => {
    setSearch("");
  }, [pathname, setSearch]);

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <TopNav />
      <div className="flex min-h-0 flex-1">
        <div className="sticky top-16 h-[calc(100vh-4rem)] self-start">
          <Sidebar />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
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
          <main id="main" className="flex-1 px-4 py-6 md:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
