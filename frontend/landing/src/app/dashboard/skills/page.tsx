"use client";

import { Plus } from "lucide-react";
import { Button, EmptyState, Loadable, Skeleton } from "@/components/ui";
import { matchesQuery, plural } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import { categoryLabel } from "@/lib/status";
import type { SkillSummary } from "@/lib/types";
import { SkillCard } from "@/nurse/components/skills/SkillCard";
import { useDashboard } from "@/nurse/context/DashboardContext";

export default function SkillsPage() {
  useTitle("Skills");
  const { search } = useDashboard();
  const { data, error, loading, reload } = useApi<SkillSummary[]>("/skills");

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-secondary">
          A skill is a reference video you record, plus the steps and pass, fail and cannot-verify
          criteria written from it. Caregivers&apos; recordings are checked against these steps, and you
          can edit any of them.
        </p>
        <Button href="/dashboard/skills/new">
          <Plus className="h-4 w-4" aria-hidden />
          New skill
        </Button>
      </div>

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
          const shown = skills.filter((skill) =>
            matchesQuery(search, skill.name, skill.summary, categoryLabel[skill.category], skill.category),
          );
          return (
            <div className="space-y-3">
              <p className="text-sm text-ink-secondary">
                {shown.length === skills.length
                  ? plural(skills.length, "skill")
                  : `${shown.length} of ${plural(skills.length, "skill")} match “${search.trim()}”`}
              </p>
              {shown.length === 0 ? (
                <EmptyState title="No skills match your search">
                  Try a different word, or clear the search box above.
                </EmptyState>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {shown.map((skill) => (
                    <SkillCard key={skill.id} skill={skill} />
                  ))}
                </div>
              )}
            </div>
          );
        }}
      </Loadable>
    </div>
  );
}
