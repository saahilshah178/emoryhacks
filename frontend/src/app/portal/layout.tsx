"use client";

import { Suspense, type ReactNode } from "react";
import { CaregiverProvider } from "@/caregiver/context/CaregiverContext";
import { AppShell } from "@/caregiver/components/layout/AppShell";
import { RefreshBoundary } from "@/shared/RefreshBoundary";
import { RoleGate } from "@/shared/RoleGate";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="caregiver">
      <RefreshBoundary>
        <CaregiverProvider>
          <Suspense fallback={<div className="min-h-dvh bg-page" />}>
            <AppShell>{children}</AppShell>
          </Suspense>
        </CaregiverProvider>
      </RefreshBoundary>
    </RoleGate>
  );
}
