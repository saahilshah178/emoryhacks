"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Camera, Info, Pencil, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { JobProgress } from "@/components/media/JobProgress";
import { VideoFrame } from "@/components/media/VideoFrame";
import { Button, Card, CardBody, EmptyState, ErrorNote, Loadable, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatClock, plural } from "@/lib/format";
import { useApi, useJob, useTitle } from "@/lib/hooks";
import { useVideoSegments } from "@/lib/segment";
import type { Job, Skill } from "@/lib/types";
import { BackLink } from "@/shared/layout/BackLink";
import { PageHeading } from "@/shared/layout/PageHeading";
import { ConfirmDialog } from "@/nurse/components/skills/ConfirmDialog";
import { ActionsCard, PeopleCard, SafetyCard, SkillFacts, VersionList } from "@/nurse/components/skills/SkillAside";
import { CaregiverCopyForm, SkillDetailsForm } from "@/nurse/components/skills/SkillForms";
import { StepCard } from "@/nurse/components/skills/StepCard";
import { StepEditor } from "@/nurse/components/skills/StepEditor";
import { isTimed } from "@/nurse/components/skills/text";
import { useDashboard } from "@/nurse/context/DashboardContext";

export default function SkillPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload, setData } = useApi<Skill>(`/skills/${id}`);
  useTitle(data?.name ?? "Skill");

  if (!data && error && /not found/i.test(error)) {
    return (
      <div className="space-y-5">
        <BackLink href="/dashboard/skills">Back to skills</BackLink>
        <EmptyState title="Skill not found">It may have been deleted, or the link is wrong.</EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <BackLink href="/dashboard/skills">Back to skills</BackLink>
      <Loadable
        data={data}
        error={error}
        loading={loading}
        reload={reload}
        skeleton={
          <div className="space-y-5">
            <Skeleton className="h-12 w-72" />
            <Skeleton className="aspect-video max-h-[480px] w-full" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        }
      >
        {(skill) => <SkillDetail key={skill.id} skill={skill} setSkill={setData} />}
      </Loadable>
    </div>
  );
}

function SkillDetail({ skill, setSkill }: { skill: Skill; setSkill: (skill: Skill) => void }) {
  const router = useRouter();
  const { reloadOverview, showFlash } = useDashboard();
  const player = useVideoSegments();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Rebuild: confirm, start, then follow the job and open the new version.
  const [rebuildAsk, setRebuildAsk] = useState(false);
  const [rebuildStarting, setRebuildStarting] = useState(false);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const onRebuilt = useCallback(
    (job: Job) => {
      reloadOverview();
      showFlash({ tone: "success", message: "The steps were rebuilt from the reference video. This is the new version." });
      router.push(job.skill_id ? `/dashboard/skills/${job.skill_id}` : "/dashboard/skills");
    },
    [reloadOverview, router, showFlash],
  );
  const { job, failed } = useJob(jobId, onRebuilt);

  // Delete this version.
  const [deleteAsk, setDeleteAsk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const steps = skill.steps;
  const video = skill.video;
  const isOld = skill.latest_id !== skill.id;
  const newest = skill.versions.find((version) => version.id === skill.latest_id);
  const thisVersion = skill.versions.find((version) => version.id === skill.id);
  const anyTimed = steps.some(isTimed);
  const canRebuild = Boolean(video?.available);
  const rebuilding = jobId !== null && !failed;
  const allOpen = steps.length > 0 && steps.every((step) => open[step.step_id]);
  const playhead = player.playing || player.time > 0 ? player.time : null;

  async function startRebuild() {
    setRebuildStarting(true);
    setRebuildError(null);
    try {
      const result = await api<{ job_id: string }>(`/skills/${skill.id}/regenerate`, { method: "POST" });
      setJobId(result.job_id);
      setRebuildAsk(false);
    } catch (error) {
      setRebuildError(errorMessage(error));
    } finally {
      setRebuildStarting(false);
    }
  }

  async function deleteVersion() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api(`/skills/${skill.id}`, { method: "DELETE" });
      reloadOverview();
      showFlash({ tone: "success", message: `Deleted version ${skill.version} of ${skill.name}.` });
      router.push("/dashboard/skills");
    } catch (error) {
      setDeleteError(errorMessage(error));
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeading
        title={skill.name}
        description={`Version ${skill.version}`}
        actions={
          editing ? (
            <Button onClick={() => setEditing(false)}>Done</Button>
          ) : (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit skill
            </Button>
          )
        }
      />

      {isOld ? (
        <div className="flex flex-wrap items-start gap-3 rounded-[12px] border border-info/20 bg-info-bg px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <p className="min-w-0 flex-1 text-ink">
            This is an older version of the skill, kept because attempts were graded against it. New attempts are
            graded against the newest version.{" "}
            <Link href={`/dashboard/skills/${skill.latest_id}`} className="font-medium text-teal hover:underline">
              Go to the newest version{newest ? ` (version ${newest.version})` : ""}
            </Link>
          </p>
        </div>
      ) : null}

      {editing ? (
        <div className="flex items-start gap-3 rounded-[12px] border border-warning/20 bg-warning-bg px-4 py-3 text-sm text-ink">
          <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p>
            You are editing version {skill.version}. Each save applies to this version straight away and changes
            how future attempts against it are graded. Attempts already graded keep their results.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <div className="min-w-0 space-y-5">
          {video ? (
            <VideoFrame
              video={video}
              videoRef={player.ref}
              label={`Reference video · ${formatClock(video.duration_s)}${video.original_name ? ` · ${video.original_name}` : ""}`}
            />
          ) : (
            <EmptyState
              title="No reference video"
              action={
                <Button href={`/dashboard/skills/new?skill=${skill.id}`}>
                  <Camera className="h-4 w-4" aria-hidden />
                  Record a reference video
                </Button>
              }
            >
              Record yourself performing this skill. The steps get times in the video, and you can play each one
              from here.
            </EmptyState>
          )}

          {jobId ? (
            <Card>
              <CardBody className="space-y-3 pt-5">
                <div>
                  <h2 className="text-base font-semibold text-navy">Rebuilding the steps from the reference video</h2>
                  <p className="mt-1 text-sm text-ink-secondary">
                    This usually takes a minute or two. The new version opens here when it is ready.
                  </p>
                </div>
                <JobProgress job={job} />
                {failed ? (
                  <ErrorNote
                    message={`The rebuild did not finish: ${failed}`}
                    onRetry={() => {
                      setJobId(null);
                      setRebuildAsk(true);
                    }}
                  />
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {editing ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <SkillDetailsForm skill={skill} onSaved={setSkill} />
              <CaregiverCopyForm skill={skill} onSaved={setSkill} />
            </div>
          ) : null}

          <section aria-labelledby="steps-label" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="steps-label" className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                Steps ({steps.length})
              </h2>
              {!editing && steps.length > 0 ? (
                <button
                  type="button"
                  className="text-sm font-medium text-teal hover:underline"
                  onClick={() =>
                    setOpen(allOpen ? {} : Object.fromEntries(steps.map((step) => [step.step_id, true])))
                  }
                >
                  {allOpen ? "Collapse all criteria" : "Expand all criteria"}
                </button>
              ) : null}
            </div>

            {steps.length > 0 && !anyTimed ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-border bg-white px-4 py-3 text-sm">
                <p className="min-w-0 flex-1 text-ink-secondary">
                  These steps have no timestamps in the reference video yet.{" "}
                  {canRebuild
                    ? "Rebuilding the steps from the video adds them."
                    : video
                      ? "They can be added once the reference video is stored on this server."
                      : "Record a reference video to add them."}
                </p>
                {canRebuild ? (
                  <Button variant="secondary" size="sm" onClick={() => setRebuildAsk(true)} disabled={rebuilding}>
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    Rebuild steps from the video
                  </Button>
                ) : null}
              </div>
            ) : null}

            {steps.length === 0 ? (
              <EmptyState title="No steps yet">
                {canRebuild
                  ? "Rebuild the steps from the reference video to write them."
                  : "Record a reference video and the steps are written from it."}
              </EmptyState>
            ) : (
              steps.map((step) =>
                editing ? (
                  <StepEditor
                    key={step.step_id}
                    skillId={skill.id}
                    step={step}
                    steps={steps}
                    video={video}
                    onSaved={setSkill}
                    onPlay={player.play}
                  />
                ) : (
                  <StepCard
                    key={step.step_id}
                    step={step}
                    steps={steps}
                    video={video}
                    active={playhead !== null && isTimed(step) && playhead >= step.start_s && playhead < step.end_s}
                    open={Boolean(open[step.step_id])}
                    onToggle={() => setOpen((current) => ({ ...current, [step.step_id]: !current[step.step_id] }))}
                    onPlay={player.play}
                  />
                ),
              )
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-5">
          <SkillFacts skill={skill} />
          <PeopleCard people={skill.people ?? []} />
          <SafetyCard points={skill.safety_criteria ?? []} />
          {skill.versions.length > 0 ? <VersionList skill={skill} /> : null}
          <ActionsCard
            skill={skill}
            rebuilding={rebuilding}
            onRebuild={() => setRebuildAsk(true)}
            onDelete={() => setDeleteAsk(true)}
          />
        </aside>
      </div>

      <ConfirmDialog
        open={rebuildAsk}
        title="Rebuild the steps from the reference video?"
        confirmLabel="Rebuild steps"
        busy={rebuildStarting}
        error={rebuildError}
        onConfirm={startRebuild}
        onCancel={() => {
          setRebuildAsk(false);
          setRebuildError(null);
        }}
      >
        <p>
          The steps and criteria are written again from the video and saved as a new version of {skill.name}. New
          attempts are graded against that version.
        </p>
        <p>This version, your edits to it and the attempts graded against it are kept.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteAsk}
        title={`Delete version ${skill.version} of ${skill.name}?`}
        confirmLabel="Delete this version"
        tone="destructive"
        busy={deleting}
        error={deleteError}
        onConfirm={deleteVersion}
        onCancel={() => {
          setDeleteAsk(false);
          setDeleteError(null);
        }}
      >
        <p>
          This also deletes{" "}
          <strong className="font-semibold text-ink">
            {plural(thisVersion?.attempt_count ?? 0, "attempt")} graded against this version
          </strong>
          , with their results and reviews. This can&apos;t be undone.
        </p>
        {skill.versions.length > 1 ? <p>Other versions of the skill are not affected.</p> : null}
      </ConfirmDialog>
    </div>
  );
}
