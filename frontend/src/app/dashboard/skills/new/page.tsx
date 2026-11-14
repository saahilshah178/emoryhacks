"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { JobProgress } from "@/components/media/JobProgress";
import {
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  ProgressBar,
  Skeleton,
} from "@/components/ui";
import { api, errorMessage, uploadVideo } from "@/lib/api";
import { useApi, useJob, useTitle } from "@/lib/hooks";
import { useRecorder } from "@/lib/recorder";
import type { Job, Skill } from "@/lib/types";
import { BackLink } from "@/shared/layout/BackLink";
import { PageHeading } from "@/shared/layout/PageHeading";
import { ReferenceRecorder } from "@/nurse/components/skills/ReferenceRecorder";
import { useDashboard } from "@/nurse/context/DashboardContext";

export default function NewSkillPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <NewSkill />
    </Suspense>
  );
}

const guidance = [
  "Keep the whole body of both the caregiver and the patient in frame, from head to feet.",
  "Perform the skill once, at normal speed, the way you want caregivers to do it.",
  "Set the camera still at about waist height, with good light and a clear floor.",
  "Stop recording as soon as the skill is finished.",
];

function NewSkill() {
  const params = useSearchParams();
  const skillId = params.get("skill");
  const existing = useApi<Skill>(skillId ? `/skills/${skillId}` : null);
  const target = existing.data;
  useTitle(target ? `New reference for ${target.name}` : "New skill");

  const router = useRouter();
  const { reloadOverview, showFlash } = useDashboard();
  const recorder = useRecorder({ facingMode: "user" });
  const [name, setName] = useState("");
  const [stage, setStage] = useState<"capture" | "uploading" | "processing">("capture");
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  // Leaving the page cancels an upload still in progress (a job already started carries on).
  useEffect(() => () => abortRef.current?.(), []);

  const onDone = useCallback(
    async (job: Job) => {
      reloadOverview();
      if (job.skill_id) {
        // Say which skill the video became: the AI may recognise it as one that already exists,
        // in which case it is saved as that skill's next version rather than as a new skill.
        try {
          const made = await api<Skill>(`/skills/${job.skill_id}`);
          showFlash({
            tone: "success",
            message:
              made.version > 1
                ? `Recognised as ${made.name}, which you already have. Saved as version ${made.version} of it; earlier versions are kept.`
                : `Saved as a new skill: ${made.name}.`,
          });
        } catch {
          // The skill still opens below; the note is only a courtesy.
        }
      }
      router.replace(job.skill_id ? `/dashboard/skills/${job.skill_id}` : "/dashboard/skills");
    },
    [reloadOverview, router, showFlash],
  );
  const { job, failed } = useJob(jobId, onDone);

  async function send() {
    const recording = recorder.recording;
    if (!recording) return;
    if (skillId && !target) return;
    setUploadError(null);
    setProgress(0);
    setStage("uploading");
    const upload = uploadVideo(
      {
        file: recording.blob,
        filename: recording.filename,
        kind: "reference",
        expectedSlug: target?.slug,
        expectedName: target ? target.name : name.trim() || undefined,
      },
      setProgress,
    );
    abortRef.current = upload.abort;
    try {
      const result = await upload.promise;
      setJobId(result.job_id);
      setStage("processing");
    } catch (error) {
      setUploadError(errorMessage(error));
      setStage("capture");
    } finally {
      abortRef.current = null;
    }
  }

  function tryAgain() {
    setJobId(null);
    setStage("capture");
  }

  const backHref = target ? `/dashboard/skills/${target.id}` : "/dashboard/skills";

  if (skillId && !target) {
    if (existing.error) {
      return (
        <div className="space-y-5">
          <BackLink href="/dashboard/skills">Back to skills</BackLink>
          {/not found/i.test(existing.error) ? (
            <EmptyState title="Skill not found" action={<Button href="/dashboard/skills">Back to skills</Button>}>
              The skill you wanted to add a reference to may have been deleted.
            </EmptyState>
          ) : (
            <ErrorNote message={existing.error} onRetry={existing.reload} />
          )}
        </div>
      );
    }
    return <Skeleton className="h-96" />;
  }

  return (
    <div className="space-y-5">
      <BackLink href={backHref}>{target ? `Back to ${target.name}` : "Back to skills"}</BackLink>

      <PageHeading
        title={target ? `New reference for ${target.name}` : "Record a reference video"}
        description={
          target
            ? `The steps and criteria are written again from this video and saved as version ${
                Math.max(target.version, ...target.versions.map((version) => version.version)) + 1
              } of ${target.name}. Earlier versions and their graded attempts are kept.`
            : "Perform the skill once on camera. The AI recognises which skill it is, splits it into timed steps and writes what passes, what fails and when a step can't be verified. You can edit all of it afterwards."
        }
      />

      {stage === "capture" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="min-w-0 space-y-5">
            {!target ? (
              <Card>
                <CardBody className="pt-5">
                  <Field
                    label="Skill name (optional)"
                    hint="Leave blank and the AI names the skill from the video. You can rename it later."
                  >
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="For example: Sit to stand with a gait belt"
                      maxLength={120}
                    />
                  </Field>
                </CardBody>
              </Card>
            ) : null}

            {uploadError ? (
              <ErrorNote message={`The video wasn't sent: ${uploadError}`} onRetry={recorder.recording ? send : undefined} />
            ) : null}

            <ReferenceRecorder recorder={recorder} onUse={send} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-navy">Before you record</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="list-disc space-y-2 pl-4 text-sm text-ink">
                {guidance.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {stage === "uploading" ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="text-navy">Sending your video</CardTitle>
              <CardDescription>Keep this page open until the upload finishes.</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            <ProgressBar value={progress * 100} label="Upload progress" />
            <div className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
              <span className="tabular-nums">{Math.round(progress * 100)}% sent</span>
              <Button variant="ghost" size="sm" onClick={() => abortRef.current?.()}>
                Cancel upload
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {stage === "processing" ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="text-navy">
                {failed ? "The video couldn't be turned into a skill" : "Building the skill from your video"}
              </CardTitle>
              <CardDescription>
                {failed
                  ? "You can send the same video again, or record a new one."
                  : "This usually takes a few minutes. You can leave this page open; the skill opens here when it is ready."}
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <JobProgress job={job} />
            {failed ? (
              <div className="space-y-3">
                <ErrorNote message={failed} />
                <Button onClick={tryAgain}>Try again</Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
