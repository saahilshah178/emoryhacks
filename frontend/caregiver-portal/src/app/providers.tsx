"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { CaregiverProvider } from "@/context/CaregiverContext";
import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider, useAuth } from "@/shared/AuthProvider";
import { dashboardHomeUrl, loginUrl } from "@/shared/urls";

function Shell({ children }: { children: ReactNode }) {
  const { ready, session } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      window.location.href = loginUrl();
      return;
    }
    if (session.role === "nurse") {
      window.location.href = dashboardHomeUrl();
    }
  }, [ready, session]);

  if (!ready || !session || session.role !== "caregiver") {
    return <div className="min-h-dvh bg-page" />;
  }

  return (
    <CaregiverProvider>
      <Suspense fallback={<div className="min-h-dvh bg-page" />}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </CaregiverProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
