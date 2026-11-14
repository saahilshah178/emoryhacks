"use client";

import type { ReactNode } from "react";
import { DashboardProvider } from "@/nurse/context/DashboardContext";
import { AppShell } from "@/nurse/components/layout/AppShell";
import { RoleGate } from "@/shared/RoleGate";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="nurse">
      <DashboardProvider>
        <AppShell>{children}</AppShell>
      </DashboardProvider>
    </RoleGate>
  );
}
