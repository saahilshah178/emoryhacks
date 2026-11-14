"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowLeft, Info } from "lucide-react";
import { MovementPanel } from "@/nurse/components/review/MovementPanel";
import { ReviewActions } from "@/nurse/components/review/ReviewActions";
import { SafetyPanel } from "@/nurse/components/review/SafetyPanel";
import { StepTimeline } from "@/nurse/components/review/StepTimeline";
import { VideoComparison } from "@/nurse/components/review/VideoComparison";
import { Avatar } from "@/nurse/components/ui/Avatar";
import { StatusBadge } from "@/nurse/components/ui/StatusBadge";
import { useDashboard } from "@/nurse/context/DashboardContext";
import { formatDateTime } from "@/nurse/lib/format";
import { getCaregiver, getSkill } from "@/nurse/lib/mock-data";

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
        <Link href="/dashboard/pending" className="mt-4 inline-flex text-sm font-medium text-teal">
          Back to pending reviews
        </Link>
      </div>
    );
  }

  const caregiver = getCaregiver(submission.caregiverId);
  const skill = getSkill(submission.skillId);
  const resolved = submission.reviewStatus !== "pending";

  function seek(value: number) {
    setPlaying(false);
    setTime(value);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <Link
        href="/dashboard/pending"
        className="inline-flex items-center gap-2 text-sm text-ink-secondary hover:text-teal"
      >
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
        onSeek={seek}
        steps={submission.detectedSteps}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] xl:items-start">
        <div className="space-y-5">
          <SafetyPanel issues={submission.safetyIssues} onSeek={seek} />
          <section>
            <h3 className="text-base font-semibold text-navy">Detected steps</h3>
            <p className="mt-1 text-sm text-ink-secondary">
              Jump both recordings to a timestamp. Status is the AI reading — you still decide.
            </p>
            <div className="mt-3">
              <StepTimeline
                steps={submission.detectedSteps}
                currentTime={time}
                onSelect={seek}
              />
            </div>
          </section>
        </div>

        <aside className="xl:sticky xl:top-20">
          <div className="rounded-[12px] border border-border bg-white p-4 shadow-[var(--shadow-card)]">
            <h3 className="text-base font-semibold text-navy">Nurse decision</h3>
            <p className="mt-1 text-sm text-ink-secondary">
              Only a registered nurse can approve this skill for independent work.
            </p>
            <div className="mt-4">
              <ReviewActions
                submissionId={submission.id}
                initialNotes={submission.notes}
                alreadyResolved={resolved}
              />
            </div>
          </div>
        </aside>
      </div>

      <section>
        <h3 className="text-base font-semibold text-navy">Movement and balance</h3>
        <div className="mt-3">
          <MovementPanel
            balance={submission.balance}
            movement={submission.movement}
            duration={submission.durationSeconds}
          />
        </div>
      </section>
    </div>
  );
}
