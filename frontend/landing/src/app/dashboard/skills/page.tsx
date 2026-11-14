"use client";

import { Plus } from "lucide-react";
import { Button, EmptyState, Loadable, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import type { SkillSummary } from "@/lib/types";
import { PageHeading } from "@/nurse/components/layout/PageHeading";
import { SkillCard } from "@/nurse/components/skills/SkillCard";

export default function SkillsPage() {
  useTitle("Skills");
  const { data, error, loading, reload } = useApi<SkillSummary[]>("/skills");

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeading
        title="Skills"
        description="A skill is a reference video you record, plus the steps and pass, fail and cannot-verify criteria written from it. Caregivers' recordings are checked against these steps, and you can edit any of them."
        actions={
          <Button href="/dashboard/skills/new">
            <Plus className="h-4 w-4" aria-hidden />
            New skill
          </Button>
        }
      />

      <Loadable
        data={data}
        error={error}
        loading={loading}
        reload={reload}
        skeleton={
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-72" />
            ))}
          </div>
        }
      >
        {(skills) => {
          if (skills.length === 0) {
            return (
              <EmptyState
                title="No skills yet"
                action={<Button href="/dashboard/skills/new">Record a reference video</Button>}
              >
                Record yourself performing a skill once, at normal speed. The steps and the criteria
                caregivers are checked against are written from that video, and appear here.
              </EmptyState>
            );
          }
          return (
            <div className="space-y-3">
              <p className="text-sm text-ink-secondary">{plural(skills.length, "skill")}</p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {skills.map((skill) => (
                  <SkillCard key={skill.id} skill={skill} />
                ))}
              </div>
            </div>
          );
        }}
      </Loadable>
    </div>
  );
}
