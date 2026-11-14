"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { homeUrlFor, LOGIN_PATH } from "./urls";
import { Logo } from "./Logo";

export function PublicHeader() {
  const { user } = useAuth();

  return (
    <header className="chrome-bar chrome-bar-fade sticky top-0 z-30 border-b border-border pt-[env(safe-area-inset-top)]">
      <div className="flex h-16 items-center justify-between gap-3 px-5 sm:px-6">
        <Logo light />

        <div className="flex shrink-0 items-center gap-1.5">
          {user ? (
            <Link
              href={homeUrlFor(user.role)}
              className="inline-flex h-11 items-center rounded-[12px] bg-white px-4 text-sm font-semibold text-teal shadow-[0_1px_2px_rgba(23,50,77,0.12)] transition-colors hover:bg-white/90"
            >
              {user.role === "nurse" ? "Open dashboard" : "Open my portal"}
            </Link>
          ) : (
            <Link
              href={LOGIN_PATH}
              className="inline-flex h-11 items-center rounded-[12px] bg-white px-4 text-sm font-semibold text-teal shadow-[0_1px_2px_rgba(23,50,77,0.12)] transition-colors hover:bg-white/90"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
