import Link from "next/link";
import { CheckCircle2, RotateCcw, Video } from "lucide-react";
import { Button } from "@/components/ui";
import { practiceHref, resultsHref } from "@/caregiver/skills";
import type { MySkill } from "@/lib/types";

/** The next skill to record: one a nurse asked to practice again, or one not started yet. */
export function StartSkillCta({ skill }: { skill: MySkill }) {
  const again = skill.state === "needs_practice";
  const Icon = again ? RotateCcw : Video;
  return (
    <section className="rounded-[12px] bg-navy p-5 text-white shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-teal">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-snug">
            {again ? `Practice again: ${skill.name}` : `Next: ${skill.name}`}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-white/80">
            {again
              ? "Your nurse left you feedback. Record this skill again when you feel ready."
              : "Record yourself doing this skill. An automatic check looks it over first, then a nurse makes the final decision."}
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-5">
        <Button href={practiceHref(skill.id)} className="w-full xl:w-auto" size="xl">
          Start a skill check
        </Button>
        {again && skill.attempt_id ? (
          <Link
            href={resultsHref(skill.id, skill.attempt_id)}
            className="block rounded-[12px] py-2 text-center text-sm font-semibold text-white/90 underline-offset-4 hover:underline"
          >
            Read your nurse&apos;s feedback
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** Shown instead of the call to action when every skill is verified or with a nurse. */
export function CaughtUpCard({ inReview }: { inReview: number }) {
  return (
    <div className="flex gap-3 rounded-[12px] border border-border shadow-[var(--shadow-card)] bg-teal-soft p-5">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-teal" aria-hidden />
      <div>
        <h2 className="text-base font-semibold text-navy">You&apos;re all caught up</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink">
          {inReview > 0
            ? "Every skill is verified or with a nurse. We'll show you their decision here as soon as it's made."
            : "Every skill is verified. Nice work. You can still practice any skill again from My skills."}
        </p>
        <Link href="/portal/skills" className="mt-3 inline-block text-sm font-semibold text-teal">
          See my skills
        </Link>
      </div>
    </div>
  );
}
