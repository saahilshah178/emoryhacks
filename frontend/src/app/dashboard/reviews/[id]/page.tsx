"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { JobProgress } from "@/components/media/JobProgress";
import { Avatar, Button, Card, CardBody, ErrorNote, Loadable, Skeleton, StateBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useApi, useJob, useTitle } from "@/lib/hooks";
import { aiAssessment, reviewState } from "@/lib/status";
import type { Attempt } from "@/lib/types";
import { BackLink } from "@/shared/layout/BackLink";
import { PageHeading } from "@/shared/layout/PageHeading";
import { ReviewWorkspace } from "@/nurse/components/review/ReviewWorkspace";

export default function SkillReviewPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Attempt>(`/attempts/${id}`);
  const processing = data?.review_state === "processing";
  // While the recording is processed, follow its job and reload the attempt when it is graded.
  const { job, failed } = useJob(processing && data?.job ? data.job.id : null, () => reload());
  useTitle(data ? `Review: ${data.skill_name}` : "Skill review");

  return (
    <div className="space-y-5">
      <BackLink href="/dashboard/pending">Back to pending reviews</BackLink>

      <Loadable
        data={data}
        error={error}
        loading={loading}
        reload={reload}
        skeleton={
          <div className="space-y-5">
            <Skeleton className="h-12 w-72" />
            <Skeleton className="h-20" />
            <div className="grid gap-4 xl:grid-cols-2">
              <Skeleton className="aspect-video" />
              <Skeleton className="aspect-video" />
            </div>
          </div>
        }
      >
        {(attempt) => (
          <>
            <ReviewHeader attempt={attempt} />
            {attempt.review_state === "processing" ? (
              <Card>
                <CardBody className="pt-5">
                  <p className="text-sm font-semibold text-ink">Still analysing this recording</p>
                  <p className="mt-1 text-sm text-ink-secondary">
                    The review opens here by itself once the AI has finished. There is nothing to decide yet.
                  </p>
                  {failed ? <ErrorNote className="mt-4" message={failed} onRetry={reload} /> : null}
                  <JobProgress job={job ?? attempt.job} className="mt-4" />
                </CardBody>
              </Card>
            ) : attempt.review_state === "error" ? (
              <Card>
                <CardBody className="pt-5">
                  <div className="flex items-start gap-3">
                    <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
                    <div>
                      <p className="text-sm font-semibold text-ink">Processing failed</p>
                      <p className="mt-1 text-sm text-ink-secondary">
                        {(attempt.job?.error ?? "The recording could not be analysed.").split("\n")[0]}
                      </p>
                      <p className="mt-2 text-sm text-ink-secondary">
                        This attempt has no AI result, so there is nothing to review. It is not a result for the
                        caregiver; they can record the skill again.
                      </p>
                    </div>
                  </div>
                  {attempt.job ? <JobProgress job={attempt.job} className="mt-4" /> : null}
                  <div className="mt-4">
                    <Button variant="secondary" href="/dashboard/pending">
                      Back to pending reviews
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ) : (
              <ReviewWorkspace key={attempt.id} attempt={attempt} />
            )}
          </>
        )}
      </Loadable>
    </div>
  );
}

function ReviewHeader({ attempt }: { attempt: Attempt }) {
  const caregiver = attempt.caregiver_name || "Unnamed caregiver";
  return (
    <PageHeading
      title={
        <Link href={`/dashboard/skills/${attempt.skill_id}`} className="hover:text-teal hover:underline">
          {attempt.skill_name}
        </Link>
      }
      description={
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Avatar name={caregiver} size="sm" />
          <span>
            {attempt.caregiver_id ? (
              <Link href={`/dashboard/caregivers/${attempt.caregiver_id}`} className="font-medium text-ink hover:text-teal hover:underline">
                {caregiver}
              </Link>
            ) : (
              <span className="font-medium text-ink">{caregiver}</span>
            )}
            {attempt.caregiver_title ? ` · ${attempt.caregiver_title}` : ""} · Submitted {formatDateTime(attempt.created_at)}
          </span>
        </p>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {attempt.score_pct !== null ? (
            <span className="mr-1 text-sm text-ink-secondary">
              AI score <span className="text-base font-semibold text-navy tabular-nums">{Math.round(attempt.score_pct)}</span> / 100
            </span>
          ) : null}
          <StateBadge entry={attempt.ai_assessment ? aiAssessment[attempt.ai_assessment] : null} />
          <StateBadge entry={reviewState[attempt.review_state]} />
        </div>
      }
    />
  );
}
