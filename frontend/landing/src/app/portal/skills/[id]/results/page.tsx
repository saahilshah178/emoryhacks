"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Video } from "lucide-react";
import { Button, Card, ErrorNote, Skeleton } from "@/components/ui";
import { AssessmentResults } from "@/caregiver/components/results/AssessmentResults";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { practiceHref } from "@/caregiver/skills";
import { useTitle } from "@/lib/hooks";

function ResultsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-20" />
      <Skeleton className="aspect-video" />
      <Skeleton className="h-40" />
    </div>
  );
}

/** ?attempt=<id> shows that attempt; without it, the attempt behind this skill's current state. */
function Results() {
  const { id } = useParams<{ id: string }>();
  const requested = useSearchParams().get("attempt");
  const { skills, counts, error, reload } = useCaregiver();
  const skill = skills.find((item) => item.id === id);
  const attemptId = requested ?? skill?.attempt_id ?? null;
  useTitle(attemptId ? null : "Result");

  if (attemptId) return <AssessmentResults key={attemptId} attemptId={attemptId} skillId={id} />;

  if (counts === undefined) {
    return error ? <ErrorNote message={error} onRetry={reload} /> : <ResultsSkeleton />;
  }

  return (
    <div className="space-y-5 py-4">
      <Card className="flex flex-col items-center p-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-soft text-teal">
          <Video className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-navy">Record this skill first</h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-secondary">
          {skill
            ? `Once you send a recording of ${skill.name.toLowerCase()}, your step-by-step results will appear here. A nurse still makes the final decision.`
            : "We couldn't find this skill in your list. Pick one from My skills to get started."}
        </p>
      </Card>
      <div className="flex flex-col gap-3">
        {skill ? (
          <Button href={practiceHref(skill.id)} size="xl" className="w-full">
            Start practice
          </Button>
        ) : null}
        <Button href="/portal/skills" variant="secondary" size="lg" className="w-full">
          Back to my skills
        </Button>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<ResultsSkeleton />}>
      <Results />
    </Suspense>
  );
}
