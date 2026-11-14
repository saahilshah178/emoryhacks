import { Clock3, RotateCcw, Video } from "lucide-react";
import { Button } from "@/caregiver/components/ui/Button";
import { Card } from "@/caregiver/components/ui/Card";
import { APP_NAME } from "@/config/branding";
import type { Skill } from "@/caregiver/types/skill";

export function ReviewScreen({
  skill,
  recordingUrl,
  onSubmit,
  onRetake,
}: {
  skill: Skill;
  recordingUrl: string | null;
  onSubmit: () => void;
  onRetake: () => void;
}) {
  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal">
          Review
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy">
          Looking good — send it when you&apos;re ready
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {APP_NAME} will look over your movements, then a nurse makes the final
          decision.
        </p>
      </header>

      <Card className="overflow-hidden">
        {recordingUrl ? (
          <video
            className="aspect-video w-full bg-navy"
            src={recordingUrl}
            controls
            playsInline
          />
        ) : (
          <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-navy text-white">
            <Video className="h-8 w-8 text-teal" aria-hidden />
            <p className="text-sm text-white/80">Practice recording ready</p>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-navy">{skill.name}</p>
            <p className="text-xs text-text-secondary">Ready to send to your nurse</p>
          </div>
          <span className="rounded-full bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning">
            Not submitted
          </span>
        </div>
      </Card>

      <Card className="flex gap-3 p-4">
        <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
        <p className="text-sm leading-relaxed text-text-secondary">
          Submitting does not certify this skill. A nurse will review the recording
          and let you know what&apos;s next.
        </p>
      </Card>

      <div className="flex flex-col gap-3">
        <Button onClick={onSubmit} className="w-full" size="lg">
          Submit for Nurse Review
        </Button>
        <Button variant="secondary" onClick={onRetake} className="w-full">
          <RotateCcw className="h-4 w-4" aria-hidden />
          Retake
        </Button>
      </div>
    </div>
  );
}
