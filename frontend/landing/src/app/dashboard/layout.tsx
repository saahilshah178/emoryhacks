"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DashboardProvider } from "@/nurse/context/DashboardContext";
import { AppShell } from "@/nurse/components/layout/AppShell";
import { Button } from "@/nurse/components/ui/Button";
import { LOGIN_PATH } from "@/shared/urls";
import { useAuth } from "@/shared/AuthProvider";

function Gate({
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

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { ready, session, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) {
      router.replace(LOGIN_PATH);
    }
  }, [ready, session, router]);

  if (!ready || !session) {
    return <div className="min-h-screen bg-page" />;
  }

  if (session.role !== "nurse") {
    return (
      <Gate
        title="This dashboard is for nurses"
        body="Sign out, then continue as a nurse to review submissions."
      >
        <Button type="button" variant="secondary" className="w-full" onClick={signOut}>
          Sign out
        </Button>
      </Gate>
    );
  }

  return (
    <DashboardProvider>
      <AppShell>{children}</AppShell>
    </DashboardProvider>
  );
}
