"use client";

import { Clock3, RotateCcw, Send } from "lucide-react";
import { Badge, Button, Card, ErrorNote } from "@/components/ui";
import { PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { formatClock } from "@/lib/format";
import type { Recording } from "@/lib/recorder";
import type { Skill } from "@/lib/types";

export function ReviewScreen({
  skill,
  recording,
  error,
  onSubmit,
  onRetake,
}: {
  skill: Skill;
  recording: Recording;
  /** Why the last upload failed, if it did. */
  error: string | null;
  onSubmit: () => void;
  onRetake: () => void;
}) {
  return (
    <div className="space-y-5">
      <PortalHeading
        eyebrow="Review"
        title="Watch it back, then send it"
        description="An automatic check looks over your movements first, then a nurse makes the final decision."
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
            onLoadedMetadata={(event) => {
              // Chrome reports a fresh WebM recording's length as Infinity until it has seen the
              // end, which breaks the seek bar. Jumping far ahead makes it work the length out.
              const video = event.currentTarget;
              if (video.duration !== Infinity) return;
              video.addEventListener(
                "durationchange",
                () => {
                  video.currentTime = 0;
                },
                { once: true },
              );
              video.currentTime = 1e9;
            }}
          />
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-navy">{skill.name}</p>
              <p className="text-xs text-ink-secondary">
                {recording.seconds > 0 ? `${formatClock(recording.seconds)} · ` : ""}Ready to send to your nurse
              </p>
            </div>
            <Badge tone="warning">Not sent yet</Badge>
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="flex gap-3 p-4">
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
            <p className="text-sm leading-relaxed text-ink-secondary">
              Submitting does not certify this skill. A nurse will review the recording and let you know what&apos;s
              next.
            </p>
          </Card>

          {error ? <ErrorNote message={`Your video wasn't sent. ${error}`} /> : null}

          <div className="flex flex-col gap-3">
            <Button onClick={onSubmit} className="w-full" size="xl">
              <Send className="h-4 w-4" aria-hidden />
              {error ? "Try sending again" : "Submit for nurse review"}
            </Button>
            <Button variant="secondary" size="lg" onClick={onRetake} className="w-full">
              <RotateCcw className="h-4 w-4" aria-hidden />
              Retake
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
