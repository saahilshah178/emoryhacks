import Link from "next/link";
import { CheckCircle2, Repeat, RotateCcw, Send, Video, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { outOfAttempts, practiceHref, resultsHref } from "@/caregiver/skills";
import { attemptsLeftLine, skillAllowance } from "@/caregiver/status";
import type { MySkill } from "@/lib/types";

type Cta = {
  icon: LucideIcon;
  title: string;
  body: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
};

function ctaFor(skill: MySkill): Cta {
  const result = skill.attempt_id ? resultsHref(skill.id, skill.attempt_id) : null;
  if (skill.ready_attempt_id) {
    return {
      icon: Send,
      title: `Good enough to send: ${skill.name}`,
      body: "Your recording scored high enough to send to your nurse. You can send it, or record again to do better.",
      primary: { href: resultsHref(skill.id, skill.ready_attempt_id), label: "See your result" },
    };
  }
  if (skill.state === "needs_practice") {
    return {
      icon: RotateCcw,
      title: `Practice again: ${skill.name}`,
      body: "Your nurse left you feedback. Record this skill again when you feel ready.",
      primary: { href: practiceHref(skill.id), label: "Start a skill check" },
      secondary: result ? { href: result, label: "Read your nurse's feedback" } : undefined,
    };
  }
  if (skill.state === "practicing") {
    if (outOfAttempts(skill)) {
      return {
        icon: Repeat,
        title: `Keep going: ${skill.name}`,
        body: "You've used all your attempts at this skill. Look over your result, and ask your nurse if you'd like more attempts.",
        primary: { href: result ?? practiceHref(skill.id), label: "See your result" },
      };
    }
    return {
      icon: Repeat,
      title: `Keep going: ${skill.name}`,
      body: "Your last recording isn't ready to send yet. Look over your result, then record it again.",
      primary: { href: practiceHref(skill.id), label: "Record again" },
      secondary: result ? { href: result, label: "See your last result" } : undefined,
    };
  }
  return {
    icon: Video,
    title: `Next: ${skill.name}`,
    body: "Record yourself doing this skill. An automatic check looks it over first, then you choose whether to send it to your nurse.",
    primary: { href: practiceHref(skill.id), label: "Start a skill check" },
  };
}

/**
 * The one thing to do next: send a recording that is ready, practise a skill the nurse sent
 * back, keep going on one partway through, or start a new one.
 */
export function StartSkillCta({ skill }: { skill: MySkill }) {
  const cta = ctaFor(skill);
  const Icon = cta.icon;
  const left = skill.ready_attempt_id ? null : attemptsLeftLine(skillAllowance(skill));
  return (
    <section className="rounded-[12px] bg-navy p-5 text-white shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-teal">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-snug">{cta.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-white/80">{cta.body}</p>
          {left ? <p className="mt-2 text-xs font-medium text-white/70">{left}</p> : null}
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-5">
        <Button href={cta.primary.href} className="w-full xl:w-auto" size="xl">
          {cta.primary.label}
        </Button>
        {cta.secondary ? (
          <Link
            href={cta.secondary.href}
            className="block rounded-[12px] py-2 text-center text-sm font-semibold text-white/90 underline-offset-4 hover:underline"
          >
            {cta.secondary.label}
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
