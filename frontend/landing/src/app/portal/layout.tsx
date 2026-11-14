"use client";

import { Suspense, type ReactNode } from "react";
import { CaregiverProvider } from "@/caregiver/context/CaregiverContext";
import { AppShell } from "@/caregiver/components/layout/AppShell";
import { RoleGate } from "@/shared/RoleGate";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="caregiver">
      <CaregiverProvider>
        <Suspense fallback={<div className="min-h-dvh bg-page" />}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </CaregiverProvider>
    </RoleGate>
  );
}
