"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { homeUrlFor, LOGIN_PATH, SIGNUP_PATH } from "./urls";
import { Logo } from "./Logo";

export function PublicHeader() {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white pt-[env(safe-area-inset-top)]">
      <div className="flex h-16 items-center justify-between gap-3 px-5 sm:px-6">
        <Logo />

        <div className="flex shrink-0 items-center gap-1.5">
          {user ? (
            <Link
              href={homeUrlFor(user.role)}
              className="inline-flex h-11 items-center rounded-[12px] bg-teal px-4 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(23,50,77,0.12)] transition-colors hover:bg-teal-hover"
            >
              {user.role === "nurse" ? "Open dashboard" : "Open my portal"}
            </Link>
          ) : (
            <>
              <Link
                href={LOGIN_PATH}
                className="inline-flex h-11 items-center rounded-[12px] px-3 text-sm font-semibold text-navy transition-colors hover:bg-secondary"
              >
                Log in
              </Link>
              <Link
                href={SIGNUP_PATH}
                className="inline-flex h-11 items-center rounded-[12px] bg-teal px-4 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(23,50,77,0.12)] transition-colors hover:bg-teal-hover"
              >
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
