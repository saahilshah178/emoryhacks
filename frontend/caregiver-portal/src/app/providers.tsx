"use client";

import { Suspense, type ReactNode } from "react";
import { CaregiverProvider } from "@/context/CaregiverContext";
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
    <div className="flex min-h-dvh items-center justify-center bg-page px-5">
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
    return <div className="min-h-dvh bg-page" />;
  }

  if (!session) {
    return (
      <AccessScreen
        title="Caregiver portal"
        body="Sign in here to record skills."
      >
        <Button
          type="button"
          className="w-full"
          onClick={() => signIn(demoUser("caregiver"))}
        >
          Continue as caregiver
        </Button>
      </AccessScreen>
    );
  }

  if (session.role !== "caregiver") {
    return (
      <AccessScreen
        title="This portal is for caregivers"
        body={`You're signed in as a nurse (${session.email}). Sign out to continue here.`}
      >
        <Button type="button" variant="secondary" className="w-full" onClick={signOut}>
          Sign out
        </Button>
      </AccessScreen>
    );
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
