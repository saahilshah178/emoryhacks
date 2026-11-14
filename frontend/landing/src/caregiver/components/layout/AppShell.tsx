"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/caregiver/components/layout/Logo";
import { AvatarButton } from "@/caregiver/components/layout/AvatarButton";
import { BottomNav } from "@/caregiver/components/layout/BottomNav";
import { cn } from "@/caregiver/lib/cn";

const desktopNav = [
  { href: "/portal", label: "Home" },
  { href: "/portal/skills", label: "My Skills" },
  { href: "/portal/profile", label: "Profile" },
];

function isImmersivePath(pathname: string) {
  return /\/skills\/[^/]+/.test(pathname);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const immersive = isImmersivePath(pathname);

  return (
    <div className="min-h-dvh w-full bg-page">
      <header className="sticky top-0 z-30 w-full border-b border-border bg-white">
        <div className="flex h-16 w-full items-center justify-between gap-3 px-6">
          <Logo />
          {!immersive ? (
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {desktopNav.map((item) => {
                const active =
                  item.href === "/portal"
                    ? pathname === "/portal"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-[12px] px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-teal-soft text-teal" : "text-navy hover:bg-secondary",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}
          <AvatarButton />
        </div>
      </header>

      <main
        id="main"
        className={cn(
          "mx-auto w-full max-w-lg px-4 md:max-w-3xl",
          immersive
            ? "pb-8 pt-5 md:pb-12"
            : "pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6 md:pb-12",
        )}
      >
        {children}
      </main>

      {immersive ? null : <BottomNav />}
    </div>
  );
}
