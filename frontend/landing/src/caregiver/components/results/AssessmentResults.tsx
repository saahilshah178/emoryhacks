import { Check, Clock3, Sparkles } from "lucide-react";
import { Button } from "@/caregiver/components/ui/Button";
import { Card } from "@/caregiver/components/ui/Card";
import type { Skill, SkillAssessment } from "@/caregiver/types/skill";

export function AssessmentResults({
  skill,
  assessment,
}: {
  skill: Skill;
  assessment: SkillAssessment;
}) {
  const passed = assessment.steps.filter((step) => step.status === "passed").length;
  const needsWork = assessment.steps.filter(
    (step) => step.status === "needs_improvement",
  ).length;
  const alreadyVerified = skill.status === "verified";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-navy">
          Your skill assessment is ready
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">
          {assessment.summary}
        </p>
      </header>

      <Card className="p-5">
        <p className="text-sm font-semibold text-navy">{skill.name}</p>
        <div className={`mt-3 grid gap-3 ${needsWork > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
          <div className="rounded-[12px] bg-success-bg px-3 py-2.5">
            <p className="text-xl font-semibold tabular-nums text-success">{passed}</p>
            <p className="text-xs font-medium text-success">Steps looking strong</p>
          </div>
          {needsWork > 0 ? (
            <div className="rounded-[12px] bg-warning-bg px-3 py-2.5">
              <p className="text-xl font-semibold tabular-nums text-warning">{needsWork}</p>
              <p className="text-xs font-medium text-warning">Worth another look</p>
            </div>
          ) : null}
        </div>
      </Card>

      <section>
        <h2 className="text-sm font-semibold text-navy">Step by step</h2>
        <Card className="mt-2 divide-y divide-border">
          {assessment.steps.map((step) => {
            const passedStep = step.status === "passed";
            return (
              <div key={step.id} className="flex items-start gap-3 px-4 py-3.5">
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    passedStep ? "bg-success-bg text-success" : "bg-warning-bg text-warning"
                  }`}
                >
                  {passedStep ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : (
                    <Clock3 className="h-4 w-4" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-navy">{step.label}</p>
                    <span
                      className={`shrink-0 text-xs font-semibold ${
                        passedStep ? "text-success" : "text-warning"
                      }`}
                    >
                      {passedStep ? "Passed" : "Needs improvement"}
                      {step.timestamp ? ` (${step.timestamp})` : ""}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      </section>

      <Card className="flex gap-3 bg-info-bg p-4">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
        <p className="text-sm leading-relaxed text-navy">
          {alreadyVerified
            ? assessment.encouragement
            : "Your assessment has been sent to a nurse for final review. An AI suggestion is not a certification."}
        </p>
      </Card>

      <div className="flex flex-col gap-3">
        {skill.status !== "verified" ? (
          <Button href={`/portal/skills/${skill.id}`} variant="secondary" className="w-full">
            Practice again
          </Button>
        ) : null}
        <Button href="/portal" className="w-full">
          Back to home
        </Button>
      </div>
    </div>
  );
}
