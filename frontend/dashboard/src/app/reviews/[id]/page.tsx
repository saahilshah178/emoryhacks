"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowLeft, Info } from "lucide-react";
import { MovementPanel } from "@/components/review/MovementPanel";
import { ReviewActions } from "@/components/review/ReviewActions";
import { SafetyPanel } from "@/components/review/SafetyPanel";
import { StepChecklist } from "@/components/review/StepChecklist";
import { StepTimeline } from "@/components/review/StepTimeline";
import { VideoComparison } from "@/components/review/VideoComparison";
import { Avatar } from "@/components/ui/Avatar";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDashboard } from "@/context/DashboardContext";
import { formatDateTime } from "@/lib/format";
import { getCaregiver, getSkill } from "@/lib/mock-data";

export default function SkillReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { getSubmission } = useDashboard();
  const submission = getSubmission(id);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || !submission) return;
    const timer = window.setInterval(() => {
      setTime((current) => {
        if (current >= submission.durationSeconds) {
          setPlaying(false);
          return submission.durationSeconds;
        }
        return Math.min(submission.durationSeconds, current + 0.1);
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, submission]);

  if (!submission) {
    return (
      <div className="mx-auto max-w-xl rounded-[12px] border border-border bg-white p-8 text-center">
        <p className="font-semibold text-ink">Submission not found</p>
        <p className="mt-2 text-sm text-ink-secondary">
          It may have been removed from this session. Return to the pending queue.
        </p>
        <Link href="/pending" className="mt-4 inline-flex text-sm font-medium text-teal">
          Back to pending reviews
        </Link>
      </div>
    );
  }

  const caregiver = getCaregiver(submission.caregiverId);
  const skill = getSkill(submission.skillId);
  const resolved = submission.reviewStatus !== "pending";

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <Link href="/pending" className="inline-flex items-center gap-2 text-sm text-ink-secondary hover:text-teal">
        <ArrowLeft className="h-4 w-4" />
        Back to pending reviews
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Avatar name={caregiver?.name ?? ""} initials={caregiver?.initials} size="lg" />
          <div>
            <h2 className="text-xl font-semibold text-navy">{skill?.name}</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {caregiver?.name} · {caregiver?.role} · Submitted {formatDateTime(submission.submittedAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={submission.aiAssessment} />
          <StatusBadge status={submission.reviewStatus} />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-[12px] border border-info/20 bg-info-bg px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <div>
          <p className="text-sm font-medium text-ink">AI recommendation — not a certification</p>
          <p className="mt-1 text-sm text-ink-secondary">{submission.aiRecommendation}</p>
        </div>
      </div>

      <VideoComparison
        currentTime={time}
        duration={submission.durationSeconds}
        playing={playing}
        onToggle={() => setPlaying((value) => !value)}
        onSeek={(value) => {
          setPlaying(false);
          setTime(value);
        }}
        steps={submission.detectedSteps}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-6">
          <SafetyPanel
            issues={submission.safetyIssues}
            onSeek={(value) => {
              setPlaying(false);
              setTime(value);
            }}
          />

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Detected steps</CardTitle>
                <p className="mt-1 text-sm text-ink-secondary">
                  Select a timestamp to scrub both recordings to that moment.
                </p>
              </div>
            </CardHeader>
            <CardBody>
              <StepTimeline
                steps={submission.detectedSteps}
                currentTime={time}
                onSelect={(value) => {
                  setPlaying(false);
                  setTime(value);
                }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>AI step-by-step assessment</CardTitle>
                <p className="mt-1 text-sm text-ink-secondary">{submission.aiSummary}</p>
              </div>
            </CardHeader>
            <CardBody>
              <StepChecklist items={submission.checklist} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Movement and balance</CardTitle>
            </CardHeader>
            <CardBody>
              <MovementPanel
                balance={submission.balance}
                movement={submission.movement}
                duration={submission.durationSeconds}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Nurse decision</CardTitle>
                <p className="mt-1 text-sm text-ink-secondary">
                  Only a registered nurse can approve this skill for independent work.
                </p>
              </div>
            </CardHeader>
            <CardBody>
              <ReviewActions
                submissionId={submission.id}
                initialNotes={submission.notes}
                alreadyResolved={resolved}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
