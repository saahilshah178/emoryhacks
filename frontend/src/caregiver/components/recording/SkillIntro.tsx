import Link from "next/link";
import { CheckCircle2, Clock3, HeartHandshake, Hourglass, Shield } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { StepChecklist } from "@/caregiver/components/recording/StepChecklist";
import { resultsHref } from "@/caregiver/skills";
import type { MySkill, Skill } from "@/lib/types";

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
  const already = standing && (standing.state === "verified" || standing.state === "in_review") ? standing : null;

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
        </p>

        {already ? (
          <Card className="flex gap-3 p-4">
            {already.state === "verified" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
            ) : (
              <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
            )}
            <div>
              <p className="text-sm font-semibold text-navy">
                {already.state === "verified" ? "A nurse has verified this skill" : "Your last recording is with a nurse"}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
                {already.state === "verified"
                  ? "You can still practice it again any time."
                  : "You can practice again while you wait. Your nurse will see your newest recording."}
              </p>
              {already.attempt_id ? (
                <Link
                  href={resultsHref(skill.id, already.attempt_id)}
                  className="mt-2 inline-block text-sm font-semibold text-teal"
                >
                  View your result
                </Link>
              ) : null}
            </div>
          </Card>
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

        <Button onClick={onContinue} className="w-full lg:w-auto" size="xl">
          {skill.video ? "Watch the demonstration" : "See the steps"}
        </Button>
      </div>

      {/* A laptop has room to show the steps from the start; a phone gets them on the next screen. */}
      <Card className="hidden p-5 lg:block">
        <StepChecklist steps={skill.steps} orderMatters={skill.order_matters} compact />
      </Card>
    </div>
  );
}
