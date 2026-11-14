"use client";

import { type ReactNode } from "react";
import { DashboardProvider } from "@/context/DashboardContext";
import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider, demoUser, useAuth } from "@/shared/AuthProvider";
import { Button } from "@/components/ui/Button";

function AccessScreen({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-5">
      <div className="w-full max-w-md rounded-[16px] border border-border bg-white p-8">
        <h1 className="text-xl font-semibold text-navy">{title}</h1>
        <p className="mt-2 text-sm text-ink-secondary">{body}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { ready, session, signIn, signOut } = useAuth();

  if (!ready) {
    return <div className="min-h-screen bg-page" />;
  }

  if (!session) {
    return (
      <AccessScreen
        title="Nurse dashboard"
        body="Sign in here to review caregiver submissions."
      >
        <Button
          type="button"
          className="w-full"
          onClick={() => signIn(demoUser("nurse"))}
        >
          Continue as nurse
        </Button>
      </AccessScreen>
    );
  }

  if (session.role !== "nurse") {
    return (
      <AccessScreen
        title="This dashboard is for nurses"
        body={`You're signed in as a caregiver (${session.email}). Sign out to continue here.`}
      >
        <Button type="button" variant="secondary" className="w-full" onClick={signOut}>
          Sign out
        </Button>
      </AccessScreen>
    );
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
