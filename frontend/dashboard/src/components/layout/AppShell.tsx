"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopNav } from "@/components/layout/TopNav";
import { useDashboard } from "@/context/DashboardContext";
import { cn } from "@/lib/cn";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { flash, clearFlash, setSearch } = useDashboard();

  useEffect(() => {
    setSearch("");
  }, [pathname, setSearch]);

  return (
    <div className="flex min-h-screen bg-page">
      <div className="sticky top-0 h-screen">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav />
        {flash && (
          <div
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
        )}
        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
