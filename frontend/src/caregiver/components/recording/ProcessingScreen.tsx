"use client";

import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Button, Card, ProgressBar } from "@/components/ui";
import { JobProgress } from "@/components/media/JobProgress";
import { useJob } from "@/lib/hooks";
import type { Job } from "@/lib/types";

function Pulse() {
  return (
    <span className="relative flex h-14 w-14" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-soft" />
      <span className="relative m-auto h-10 w-10 animate-spin rounded-full border-[3px] border-teal-soft border-t-teal" />
    </span>
  );
}

/**
 * After "Check my recording": the upload's progress, then the pipeline's stages until the result is
 * ready (onDone), or a plain explanation if the processing fails.
 */
export function ProcessingScreen({
  skillName,
  progress,
  jobId,
  attemptHref,
  onDone,
  onSendAgain,
  onRecordAgain,
}: {
  skillName: string;
  /** 0..1 while the file is being sent. */
  progress: number;
  /** Set once the upload has been accepted. */
  jobId: string | null;
  /** The new attempt's result page, once it exists. */
  attemptHref: string | null;
  onDone: (job: Job) => void;
  onSendAgain: () => void;
  onRecordAgain: () => void;
}) {
  const { job, failed } = useJob(jobId, onDone);

  if (failed) {
    return (
      <div className="mx-auto max-w-xl space-y-5 py-4">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg text-danger">
            <CircleAlert className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-navy">We couldn&apos;t finish checking your video</h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-secondary">
            This was a problem on our side while processing the video. It is not a result for your attempt, and it did
            not use one of your attempts. Please try again.
          </p>
        </div>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">What happened</p>
          <p className="mt-1 text-sm text-ink">{failed}</p>
          {job ? <JobProgress job={job} className="mt-4" /> : null}
        </Card>
        <div className="flex flex-col gap-3">
          <Button onClick={onSendAgain} size="xl" className="w-full">
            Check the same video again
          </Button>
          <Button variant="secondary" size="lg" onClick={onRecordAgain} className="w-full">
            Record again
          </Button>
          {attemptHref ? (
            <Link href={attemptHref} className="py-2 text-center text-sm font-semibold text-teal">
              See this attempt
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  if (!jobId) {
    const percent = Math.round(progress * 100);
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <Pulse />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-navy">Uploading your video…</h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-secondary">
          Please keep this page open until it has uploaded. It goes to the automatic check, not to your nurse.
        </p>
        <div className="mt-6 w-full max-w-sm">
          <ProgressBar value={percent} max={100} label="Uploading your video" />
          <p className="mt-2 text-sm font-medium tabular-nums text-navy" aria-live="polite">
            {percent < 100 ? `Uploading your video… ${percent}%` : "Uploaded. Getting it ready…"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <Pulse />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-navy">Looking over your movements…</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-secondary">
        We&apos;re comparing your {skillName.toLowerCase()} with your nurse&apos;s example. This usually takes a minute
        or two, and the page moves on to your result by itself. You decide whether to send it to your nurse after you
        see it.
      </p>
      <Card className="mt-6 w-full max-w-sm p-4 text-left">
        <JobProgress job={job} />
      </Card>
      {attemptHref ? (
        <p className="mt-4 max-w-sm text-xs text-ink-secondary">
          You can leave this page: your recording is saved, and the result will appear under My skills.
        </p>
      ) : null}
    </div>
  );
}
