import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

// The dark "next step" card (Keep going, Practice again, Next, Being checked, Good enough to send)
// was removed from the portal home; the figures and My skills list already show what to do.

/** Shown on the portal home when every skill is verified or with a nurse. */
export function CaughtUpCard({ inReview }: { inReview: number }) {
  return (
    <div className="flex gap-3 rounded-[12px] border border-border shadow-[var(--shadow-card)] bg-teal-soft p-5">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-teal" aria-hidden />
      <div>
        <h2 className="text-base font-semibold text-navy">You&apos;re all caught up</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink">
          {inReview > 0
            ? "Every skill is verified or with your nurse. We'll show you their decision here as soon as it's made."
            : "Every skill is verified. Nice work. You can still practice any skill again from My skills."}
        </p>
        <Link href="/portal/skills" className="mt-3 inline-block text-sm font-semibold text-teal">
          See my skills
        </Link>
      </div>
    </div>
  );
}
