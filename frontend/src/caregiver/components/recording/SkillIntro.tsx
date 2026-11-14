import Link from "next/link";
import { CheckCircle2, CircleSlash, Clock3, HeartHandshake, Hourglass, Repeat, Send, Shield } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Card } from "@/components/ui";
import { PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { StepChecklist } from "@/caregiver/components/recording/StepChecklist";
import { outOfAttempts, resultsHref } from "@/caregiver/skills";
import { attemptsLeftLine, noAttemptsLeft } from "@/caregiver/status";
import type { MySkill, Skill } from "@/lib/types";

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="flex gap-3 p-4">
      {icon}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-navy">{title}</p>
        {children}
      </div>
    </Card>
  );
}

/** Where they stand on this skill, when it changes what they should do before recording. */
function Standing({ skill, standing }: { skill: Skill; standing: MySkill }) {
  const link = (attemptId: string | null, label: string) =>
    attemptId ? (
      <Link href={resultsHref(skill.id, attemptId)} className="mt-2 inline-block text-sm font-semibold text-teal">
        {label}
      </Link>
    ) : null;

  if (standing.ready_attempt_id) {
    return (
      <Notice icon={<Send className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />} title="You have a recording ready to send">
        <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
          It passed the automatic check. Send it to your nurse, or record a new one if you&apos;d like to do better.
        </p>
        {link(standing.ready_attempt_id, "Review and send it")}
      </Notice>
    );
  }
  if (standing.state === "verified") {
    return (
      <Notice icon={<CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />} title="A nurse has verified this skill">
        <p className="mt-1 text-sm leading-relaxed text-ink-secondary">You can still practice it again any time.</p>
        {link(standing.attempt_id, "View your result")}
      </Notice>
    );
  }
  if (standing.state === "in_review") {
    return (
      <Notice icon={<Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />} title="Your last recording is with your nurse">
        <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
          You can keep practicing while you wait. If you send a newer recording, your nurse will review that one
          instead.
        </p>
        {link(standing.attempt_id, "View your result")}
      </Notice>
    );
  }
  return null;
}

export function SkillIntro({
  skill,
  standing,
  onContinue,
}: {
  skill: Skill;
  /** The caregiver's standing on this skill, when the portal knows it. */
  standing: MySkill | undefined;
  onContinue: () => void;
}) {
  const minutes = skill.guide.estimated_minutes;
  const explanation = skill.guide.explanation || skill.summary;
  const blocked = standing && outOfAttempts(standing) ? standing : null;
  const left = standing ? attemptsLeftLine({ allowed: standing.attempts_allowed, left: standing.attempts_left }) : null;
  // With nothing left to record, their results are the way on: the one to send if there is one.
  const resultId = blocked ? (blocked.ready_attempt_id ?? blocked.attempt_id ?? blocked.latest_attempt_id) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <div className="space-y-5">
        <PortalHeading
          title={skill.name}
          description={explanation ? <p className="text-[15px] leading-relaxed">{explanation}</p> : undefined}
        />

        <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-secondary">
          {minutes > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-navy">
              <Clock3 className="h-4 w-4 text-teal" aria-hidden />
              About {minutes} {minutes === 1 ? "minute" : "minutes"}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5 font-medium text-navy">
            <HeartHandshake className="h-4 w-4 text-teal" aria-hidden />
            Practice, not a test
          </span>
          {standing ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-navy">
              <Repeat className="h-4 w-4 text-teal" aria-hidden />
              {left ?? "Unlimited attempts"}
            </span>
          ) : null}
        </p>

        {blocked ? (
          <Notice icon={<CircleSlash className="mt-0.5 h-5 w-5 shrink-0 text-ink-secondary" aria-hidden />} title="No attempts left">
            <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
              {noAttemptsLeft(blocked.attempts_allowed ?? 0)} Your recordings and their results are still here for you
              to look back on.
            </p>
          </Notice>
        ) : standing ? (
          <Standing skill={skill} standing={standing} />
        ) : null}

        {skill.guide.safety_reminder.trim() ? (
          <div className="flex gap-3 rounded-[12px] border border-border shadow-[var(--shadow-card)] bg-info-bg p-4">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-navy">Safety reminder</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{skill.guide.safety_reminder}</p>
            </div>
          </div>
        ) : null}

        {blocked ? (
          <div className="flex flex-col gap-3 lg:flex-row">
            {resultId ? (
              <Button href={resultsHref(skill.id, resultId)} className="w-full lg:w-auto" size="xl">
                {blocked.ready_attempt_id ? "Review and send your recording" : "See your results"}
              </Button>
            ) : null}
            <Button href="/portal/skills" variant="secondary" size="lg" className="w-full lg:min-h-14 lg:w-auto">
              Back to my skills
            </Button>
          </div>
        ) : (
          <Button onClick={onContinue} className="w-full lg:w-auto" size="xl">
            {skill.video ? "Watch the demonstration" : "See the steps"}
          </Button>
        )}
      </div>

      {/* A laptop has room to show the steps from the start; a phone gets them on the next screen. */}
      <Card className="hidden p-5 lg:block">
        <StepChecklist steps={skill.steps} orderMatters={skill.order_matters} compact />
      </Card>
    </div>
  );
}
