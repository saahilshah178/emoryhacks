import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/** The link above a page's heading that goes back to the list the page belongs to. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-sm text-ink-secondary hover:text-teal">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {children}
    </Link>
  );
}
