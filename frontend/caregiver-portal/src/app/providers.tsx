"use client";

import { Suspense } from "react";
import { CaregiverProvider } from "@/context/CaregiverContext";
import { AppShell } from "@/components/layout/AppShell";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CaregiverProvider>
      <Suspense fallback={<div className="min-h-dvh bg-bg" />}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </CaregiverProvider>
  );
}
