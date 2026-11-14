"use client";

import { useEffect, type ReactNode } from "react";
import { DashboardProvider } from "@/context/DashboardContext";
import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider, useAuth } from "@/shared/AuthProvider";
import { caregiverHomeUrl, loginUrl } from "@/shared/urls";

function Shell({ children }: { children: ReactNode }) {
  const { ready, session } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      window.location.href = loginUrl();
      return;
    }
    if (session.role === "caregiver") {
      window.location.href = caregiverHomeUrl();
    }
  }, [ready, session]);

  if (!ready || !session || session.role !== "nurse") {
    return <div className="min-h-screen bg-page" />;
  }

  return (
    <DashboardProvider>
      <AppShell>{children}</AppShell>
    </DashboardProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
