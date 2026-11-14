import { Circle, CircleCheck } from "lucide-react";
import type { SkillStep } from "@/types/skill";

export function StepChecklist({
  steps,
  title = "What you will show",
}: {
  steps: SkillStep[];
  title?: string;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-navy">{title}</h3>
      <ol className="mt-3 space-y-2.5">
        {steps.map((step, index) => (
          <li key={step.id} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-teal">
              {index === 0 ? (
                <CircleCheck className="h-5 w-5" aria-hidden />
              ) : (
                <Circle className="h-5 w-5" aria-hidden />
              )}
            </span>
            <div>
              <p className="text-sm font-semibold text-navy">{step.label}</p>
              <p className="text-sm leading-relaxed text-text-secondary">
                {step.detail}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
