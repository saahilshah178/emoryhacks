"use client";

import { APP_NAME } from "./brand";
import { LOGIN_PATH, SIGNUP_PATH } from "./urls";
import { Logo } from "./Logo";

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[4.25rem] max-w-[1120px] items-center justify-between gap-4 px-6">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm font-medium text-ink md:flex">
          <a href="#how-it-works" className="transition-colors hover:text-teal">
            How it works
          </a>
          <a href="#for-teams" className="transition-colors hover:text-teal">
            For your team
          </a>
        </nav>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <a
            href={LOGIN_PATH}
            className="inline-flex h-11 items-center rounded-[12px] px-3 text-sm font-semibold text-navy transition-colors hover:bg-secondary"
          >
            Log in
          </a>
          <a
            href={SIGNUP_PATH}
            className="inline-flex h-11 items-center rounded-[12px] bg-teal px-3.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(23,50,77,0.12)] transition-colors hover:bg-teal-hover sm:px-4"
          >
            Create account
          </a>
        </div>
      </div>
      <span className="sr-only">{APP_NAME}</span>
    </header>
  );
}
