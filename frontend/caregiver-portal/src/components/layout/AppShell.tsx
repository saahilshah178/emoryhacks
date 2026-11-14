"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { AvatarButton } from "@/components/layout/AvatarButton";
import { BottomNav } from "@/components/layout/BottomNav";
import { cn } from "@/lib/cn";

const desktopNav = [
  { href: "/", label: "Home" },
  { href: "/skills", label: "My Skills" },
  { href: "/progress", label: "My Progress" },
  { href: "/profile", label: "Profile" },
];

function isImmersivePath(pathname: string) {
  return /\/skills\/[^/]+/.test(pathname);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const immersive = isImmersivePath(pathname);
  const isHome = pathname === "/";

  return (
    <div className="min-h-dvh w-full bg-page">
      <header className="sticky top-0 z-20 w-full bg-navy">
        <div className="mx-auto flex h-16 w-full max-w-lg items-center justify-between gap-3 px-4 md:max-w-3xl">
          {immersive && !isHome ? (
            <Link
              href="/"
              className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-white/90"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Home
            </Link>
          ) : (
            <Logo light />
          )}
          {!immersive ? (
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {desktopNav.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-[12px] px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-teal text-white" : "text-white/80 hover:bg-white/10",
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
