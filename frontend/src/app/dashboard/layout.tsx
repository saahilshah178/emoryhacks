"use client";

import type { ReactNode } from "react";
import { DashboardProvider } from "@/nurse/context/DashboardContext";
import { AppShell } from "@/nurse/components/layout/AppShell";
import { RefreshBoundary } from "@/shared/RefreshBoundary";
import { RoleGate } from "@/shared/RoleGate";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="nurse">
      <RefreshBoundary>
        <DashboardProvider>
          <AppShell>{children}</AppShell>
        </DashboardProvider>
      </RefreshBoundary>
    </RoleGate>
  );
}
