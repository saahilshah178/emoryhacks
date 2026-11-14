"use client";

import { useParams } from "next/navigation";
import { AssessmentResults } from "@/components/results/AssessmentResults";
import { Button } from "@/components/ui/Button";
import { useCaregiver } from "@/context/CaregiverContext";

export default function ResultsPage() {
  const params = useParams<{ id: string }>();
  const { skills } = useCaregiver();
  const skill = skills.find((item) => item.id === params.id);

  if (!skill) {
    return (
      <div className="space-y-4 py-10 text-center">
        <h1 className="text-xl font-bold text-navy">We couldn&apos;t find that skill</h1>
        <Button href="/skills">Back to My Skills</Button>
      </div>
    );
  }

  if (!skill.assessment) {
    return (
      <div className="space-y-4 py-6">
        <h1 className="text-2xl font-bold text-navy">Results are on the way</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          Record this skill first and we&apos;ll share a step-by-step look with you
          — a nurse still makes the final decision.
        </p>
        <Button href={`/skills/${skill.id}`} className="w-full">
          Start practicing
        </Button>
      </div>
    );
  }

  return <AssessmentResults skill={skill} assessment={skill.assessment} />;
}
