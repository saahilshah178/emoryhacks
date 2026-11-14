"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Wraps the page content of a shell. The content fades in each time a different page is
 * shown, and again when the page is refreshed (see RefreshBoundary): the same entrance in
 * every case. People who ask for reduced motion get the content without the fade.
 */
export function PageTransition({ className, children }: { className?: string; children: ReactNode }) {
  const pathname = usePathname();
  return (
    // A new key mounts the wrapper again, and a newly mounted element plays its animation.
    <div key={pathname} className={cn("animate-refresh-in motion-reduce:animate-none", className)}>
      {children}
    </div>
  );
}
