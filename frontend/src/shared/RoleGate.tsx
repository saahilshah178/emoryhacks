"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { Role } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { homeUrlFor, LOGIN_PATH } from "./urls";

const copy: Record<Role, { title: string; body: string; other: string }> = {
  nurse: {
    title: "This dashboard is for nurses",
    body: "You are signed in as a caregiver. Go to your portal, or sign out and log in with a nurse account.",
    other: "Go to the caregiver portal",
  },
  caregiver: {
    title: "This portal is for caregivers",
    body: "You are signed in as a nurse. Go to your dashboard, or sign out and log in with a caregiver account.",
    other: "Go to the nurse dashboard",
  },
};

/**
 * Wraps the pages of one role. Visitors who are not signed in go to the login page; a
 * signed-in user of the other role is told so and offered the way to their own home.
 * The API enforces the same rule on every request, so this is for navigation, not security.
 */
export function RoleGate({ role, children }: { role: Role; children: ReactNode }) {
  const { ready, user, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace(LOGIN_PATH);
  }, [ready, user, router]);

  if (!ready || !user) return <div className="min-h-dvh bg-page" />;

  if (user.role !== role) {
    const text = copy[role];
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page px-5">
        <div className="w-full max-w-md rounded-[16px] border border-border bg-white p-8">
          <h1 className="text-xl font-semibold text-navy">{text.title}</h1>
          <p className="mt-2 text-sm text-ink-secondary">{text.body}</p>
          <div className="mt-6 flex flex-col gap-2">
            <Button href={homeUrlFor(user.role)} className="w-full">
              {text.other}
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
