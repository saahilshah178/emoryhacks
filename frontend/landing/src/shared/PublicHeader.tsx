"use client";

import { useState } from "react";
import { APP_NAME } from "./brand";
import { LOGIN_PATH, SIGNUP_PATH } from "./urls";
import { Logo } from "./Logo";

const links = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#for-teams", label: "For nurses" },
];

export function PublicHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white pt-[env(safe-area-inset-top)]">
      <div className="flex h-16 items-center justify-between gap-3 px-5 sm:px-6">
        <Logo />

        <nav className="hidden items-center gap-7 text-sm font-medium text-ink md:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-teal">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="inline-flex h-11 items-center rounded-[12px] px-3 text-sm font-semibold text-navy hover:bg-secondary md:hidden"
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
          <a
            href={LOGIN_PATH}
            className="inline-flex h-11 items-center rounded-[12px] px-3 text-sm font-semibold text-navy transition-colors hover:bg-secondary"
          >
            Log in
          </a>
          <a
            href={SIGNUP_PATH}
            className="hidden h-11 items-center rounded-[12px] bg-teal px-4 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(23,50,77,0.12)] transition-colors hover:bg-teal-hover sm:inline-flex"
          >
            Create account
          </a>
        </div>
      </div>

      {menuOpen ? (
        <nav
          id="site-menu"
          className="border-t border-border bg-white px-5 py-3 md:hidden"
          aria-label={`${APP_NAME} sections`}
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="flex h-11 items-center text-sm font-medium text-ink"
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
