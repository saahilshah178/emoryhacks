"use client";

import { VideoOff } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { thumbUrl, videoUrl } from "@/lib/api";
import type { Video } from "@/lib/types";

/**
 * A stored video with the browser's own controls, or a plain notice when the file is not
 * on this server (sample data, or a recording made on another machine).
 * Pass the ref from useVideoSegments() to drive it from time chips.
 */
export function VideoFrame({
  video,
  videoRef,
  label,
  missing,
  className,
}: {
  video: Pick<Video, "id" | "available" | "duration_s"> | null | undefined;
  videoRef?: Ref<HTMLVideoElement>;
  /** Shown in a caption bar under the video. */
  label?: ReactNode;
  /** Replaces the default "not available" notice. */
  missing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-[12px] border border-border bg-navy shadow-[var(--shadow-card)]", className)}>
      {video?.available ? (
        <video
          ref={videoRef}
          className="aspect-video w-full bg-black"
          src={videoUrl(video.id)}
          poster={thumbUrl(video.id, Math.min(1, video.duration_s / 2))}
          controls
          playsInline
          preload="metadata"
        />
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center gap-2 px-6 text-center text-white">
          {missing ?? (
            <>
              <VideoOff className="h-7 w-7 text-white/60" aria-hidden />
              <p className="text-sm text-white/80">
                {video ? "This recording isn't stored on this server." : "No video yet."}
              </p>
            </>
          )}
        </div>
      )}
      {label ? <div className="bg-[#12283c] px-4 py-2 text-xs text-white/70">{label}</div> : null}
    </div>
  );
}
