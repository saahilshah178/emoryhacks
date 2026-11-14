"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { SkillCheckClient } from "@/app/skills/[id]/skill-check-client";
import { Button } from "@/components/ui/Button";
import { useCaregiver } from "@/context/CaregiverContext";

export default function SkillCheckPage() {
  const params = useParams<{ id: string }>();
  const { skills } = useCaregiver();
  const skill = skills.find((item) => item.id === params.id);

  if (!skill) {
    return (
      <div className="space-y-4 py-10 text-center">
        <h1 className="text-xl font-bold text-navy">We couldn&apos;t find that skill</h1>
        <p className="text-sm text-text-secondary">
          Let&apos;s head back and pick another one to practice.
        </p>
        <Button href="/skills">Back to My Skills</Button>
      </div>
    );
  }

  if (skill.status === "verified") {
    return (
      <div className="space-y-4 py-6">
        <h1 className="text-2xl font-bold text-navy">{skill.name}</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          A nurse has already verified this skill. You can still review the
          assessment or practice again anytime.
        </p>
        <Button href={`/skills/${skill.id}/results`} className="w-full">
          View results
        </Button>
        <Link
          href="/skills"
          className="block text-center text-sm font-semibold text-teal"
        >
          Choose a different skill
        </Link>
      </div>
    );
  }

  return <SkillCheckClient skill={skill} />;
}
