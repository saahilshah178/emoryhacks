"use client";

import { Clock3, RotateCcw, ScanSearch } from "lucide-react";
import { Badge, Button, Card, ErrorNote } from "@/components/ui";
import { PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { formatClock } from "@/lib/format";
import { settleRecordingDuration, type Recording } from "@/lib/recorder";
import type { AttemptAllowance, Skill } from "@/lib/types";

/** "This will be attempt 2 of 3." from where they stand before this one is checked. */
function attemptLine(allowance: AttemptAllowance | null) {
  if (!allowance || allowance.used === null) return "Having it checked uses one of your attempts at this skill.";
  if (allowance.allowed === null) return "Having it checked uses one attempt. You have unlimited attempts at this skill.";
  if (allowance.left === 0) {
    return `Having it checked uses one of your attempts, and you have used ${
      allowance.allowed === 1 ? "your only one" : `all ${allowance.allowed}`
    }.`;
  }
  return `Having it checked uses one of your attempts. This will be attempt ${allowance.used + 1} of ${allowance.allowed}.`;
}

export function ReviewScreen({
  skill,
  recording,
  allowance,
  error,
  blocked,
  onSubmit,
  onRetake,
}: {
  skill: Skill;
  recording: Recording;
  /** Their attempts at this skill before this recording, when the portal knows them. */
  allowance: AttemptAllowance | null;
  /** Why the last upload failed, if it did. */
  error: string | null;
  /**
   * Set when the server refused the recording for good (no attempts left, or the skill is not
   * theirs): where to go instead, since trying again would be refused too.
   */
  blocked: { href: string; label: string } | null;
  onSubmit: () => void;
  onRetake: () => void;
}) {
  return (
    <div className="space-y-5">
      <PortalHeading
        eyebrow="Review"
        title="Watch it back, then have it checked"
        description="An automatic check looks over your movements and shows you a result. Nothing goes to your nurse until you choose to send it."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Card className="overflow-hidden">
          <video
            className="aspect-video w-full bg-navy"
            src={recording.url}
            controls
            playsInline
            preload="metadata"
            aria-label="Your recording"
            onLoadedMetadata={(event) => settleRecordingDuration(event.currentTarget)}
          />
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-navy">{skill.name}</p>
              <p className="text-xs text-ink-secondary">
                {recording.seconds > 0 ? `${formatClock(recording.seconds)} · ` : ""}Ready to be checked
              </p>
            </div>
            <Badge tone="neutral">Not checked yet</Badge>
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="flex gap-3 p-4">
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
            <div className="space-y-2 text-sm leading-relaxed text-ink-secondary">
              <p className="font-medium text-navy">{attemptLine(allowance)}</p>
              <p>
                Your result shows a score and where each step is in your video, so you can compare it with the
                demonstration. If the score is high enough, you can then send it to your nurse, who makes the final
                decision.
              </p>
            </div>
          </Card>

          {recording.stoppedAtLimit ? (
            <p role="status" className="rounded-[12px] bg-warning-bg px-4 py-3 text-sm text-warning">
              The recording stopped by itself at {formatClock(recording.seconds)}, when it reached the limit for one
              recording. If it cut off before you finished, retake it and leave out any waiting around.
            </p>
          ) : null}

          {blocked && error ? (
            <ErrorNote message={error} />
          ) : error ? (
            <ErrorNote message={`Your video wasn't uploaded. ${error}`} />
          ) : null}

          {blocked ? (
            <div className="flex flex-col gap-3">
              <Button href={blocked.href} className="w-full" size="xl">
                {blocked.label}
              </Button>
              <Button href="/portal/skills" variant="secondary" size="lg" className="w-full">
                Back to my skills
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Button onClick={onSubmit} className="w-full" size="xl">
                <ScanSearch className="h-4 w-4" aria-hidden />
                {error ? "Try again" : "Check my recording"}
              </Button>
              <Button variant="secondary" size="lg" onClick={onRetake} className="w-full">
                <RotateCcw className="h-4 w-4" aria-hidden />
                Retake
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
