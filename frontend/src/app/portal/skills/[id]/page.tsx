"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, ErrorNote, Skeleton } from "@/components/ui";
import { SkillCheckClient } from "@/app/portal/skills/[id]/skill-check-client";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { practiceHref } from "@/caregiver/skills";
import { useApi, useTitle } from "@/lib/hooks";
import type { Skill } from "@/lib/types";

export default function SkillCheckPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { skills } = useCaregiver();
  const { data: skill, error, status, reload } = useApi<Skill>(`/skills/${id}`);
  const outdated = skill !== undefined && skill.latest_id !== skill.id;
  useTitle(skill?.name ?? "Practice");

  // An older version of a skill: practise its newest version instead.
  useEffect(() => {
    if (skill && skill.latest_id !== skill.id) router.replace(practiceHref(skill.latest_id));
  }, [skill, router]);

  if (skill === undefined && error) {
    return (
      <div className="space-y-4 py-6">
        <h1 className="text-xl font-semibold text-navy">We couldn&apos;t open this skill</h1>
        {status === 404 || status === 403 ? (
          <ErrorNote message="This skill isn't in your list. It may have been removed, or it may not be assigned to you." />
        ) : (
          <ErrorNote message={error} onRetry={reload} />
        )}
        <Button href="/portal/skills" variant="secondary" size="lg" className="w-full lg:w-auto">
          Back to my skills
        </Button>
      </div>
    );
  }

  if (skill === undefined || outdated) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-1.5" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-14" />
      </div>
    );
  }

  return (
    <SkillCheckClient
      key={skill.id}
      skill={skill}
      standing={skills.find((item) => item.id === skill.id || item.slug === skill.slug)}
    />
  );
}
