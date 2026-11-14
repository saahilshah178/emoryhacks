"use client";

import type { ReactNode, Ref } from "react";
import { VideoOff } from "lucide-react";
import { VideoFrame } from "@/components/media/VideoFrame";
import { formatClock } from "@/lib/format";
import type { Video } from "@/lib/types";

/**
 * The caregiver's recording beside the nurse's reference (stacked below xl), each with its
 * own steps underneath: the step timeline under the recording, the reference's chapters
 * under the reference. A recording that is not on this server shows a calm notice instead;
 * nothing is simulated in its place.
 */
export function VideoComparison({
  video,
  videoRef,
  time,
  reference,
  referenceRef,
  referenceCaption,
  timeline,
  referenceTimeline,
}: {
  video: Video;
  videoRef: Ref<HTMLVideoElement>;
  time: number;
  reference: Video | null;
  referenceRef: Ref<HTMLVideoElement>;
  /** What the reference is showing, e.g. the step being compared. */
  referenceCaption: string | null;
  timeline: ReactNode;
  /** The steps over the reference video; shown when there is a reference to play. */
  referenceTimeline?: ReactNode;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-2 xl:items-start" aria-label="Recordings">
      <div className="min-w-0 space-y-3">
        <VideoFrame
          video={video}
          videoRef={videoRef}
          label={
            <span className="flex items-center justify-between gap-3">
              <span>Caregiver&apos;s recording</span>
              {video.available ? (
                <span className="tabular-nums">
                  {formatClock(time)} / {formatClock(video.duration_s)}
                </span>
              ) : null}
            </span>
          }
          missing={
            <>
              <VideoOff className="h-7 w-7 text-white/60" aria-hidden />
              <p className="text-sm font-medium text-white">This recording isn&apos;t stored on this server</p>
              <p className="max-w-sm text-xs text-white/70">
                It was recorded on another machine, so there is nothing to play. The steps, times and
                AI findings below are still here to review.
              </p>
            </>
          }
        />
        <div className="rounded-[12px] border border-border bg-white p-4">{timeline}</div>
      </div>
      <div className="min-w-0 space-y-3">
        {reference ? (
          <VideoFrame
            video={reference}
            videoRef={referenceRef}
            label={
              <span className="flex items-center justify-between gap-3">
                <span>Approved reference</span>
                {referenceCaption ? <span className="truncate">{referenceCaption}</span> : null}
              </span>
            }
            missing={
              <>
                <VideoOff className="h-7 w-7 text-white/60" aria-hidden />
                <p className="text-sm font-medium text-white">The reference video isn&apos;t stored on this server</p>
                <p className="max-w-sm text-xs text-white/70">Steps can&apos;t be compared side by side.</p>
              </>
            }
          />
        ) : (
          <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-border bg-white px-6 text-center">
            <VideoOff className="h-7 w-7 text-ink-secondary" aria-hidden />
            <p className="text-sm font-medium text-ink">No reference video for this skill</p>
            <p className="max-w-sm text-xs text-ink-secondary">
              Upload a reference demonstration on the skill&apos;s page to compare steps side by side.
            </p>
          </div>
        )}
        {reference?.available && referenceTimeline ? (
          <div className="rounded-[12px] border border-border bg-white p-4">{referenceTimeline}</div>
        ) : null}
      </div>
    </section>
  );
}
