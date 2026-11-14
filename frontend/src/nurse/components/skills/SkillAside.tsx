import Link from "next/link";
import { Activity, Camera, RefreshCw, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatClock, formatDate, plural } from "@/lib/format";
import { categoryLabel } from "@/lib/status";
import type { Person, Skill } from "@/lib/types";

const roleLabel: Record<Person["role"], string> = {
  caregiver: "Caregiver",
  patient: "Patient",
  other: "Other person",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-navy">{title}</CardTitle>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** Summary, category, order and length of the reference. */
export function SkillFacts({ skill }: { skill: Skill }) {
  const facts: Array<[string, ReactNode]> = [
    ["Category", categoryLabel[skill.category] ?? categoryLabel.other],
    ["Step order", skill.order_matters ? "Order matters" : "Any order"],
    ["Reference length", skill.video ? formatClock(skill.video.duration_s) : "No reference video"],
    ["Steps", String(skill.steps.length)],
  ];
  return (
    <Section title="About this skill">
      {skill.summary ? <p className="text-sm text-ink">{skill.summary}</p> : null}
      <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-3 text-sm", skill.summary && "mt-4")}>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-secondary">{label}</dt>
            <dd className="mt-0.5 font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function PeopleCard({ people }: { people: Person[] }) {
  return (
    <Section title="People in the reference">
      {people.length === 0 ? (
        <p className="text-sm text-ink-secondary">Nobody was identified in the reference video.</p>
      ) : (
        <ul className="space-y-3">
          {people.map((person) => (
            <li key={`${person.label}-${person.role}`} className="flex items-start gap-3 text-sm">
              <Badge tone={person.role === "patient" ? "info" : person.role === "caregiver" ? "teal" : "neutral"}>
                {roleLabel[person.role] ?? person.role}
              </Badge>
              <span className="min-w-0 text-ink-secondary">
                <span className="font-medium text-ink">{person.label}</span>
                {person.description ? ` · ${person.description}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * What was left out or rewritten when the steps were written (for example, text that could only
 * be heard), or what a revision of a standard skill changed. Nothing when there are no notes.
 */
export function BuildNotesCard({ notes }: { notes: string }) {
  if (!notes.trim()) return null;
  return (
    <Section title="Notes from building these steps">
      <p className="whitespace-pre-line break-words text-sm text-ink-secondary">{notes.trim()}</p>
    </Section>
  );
}

export function SafetyCard({ points }: { points: string[] }) {
  return (
    <Section title="Safety points">
      {points.length === 0 ? (
        <p className="text-sm text-ink-secondary">No safety points written. Add them in edit mode.</p>
      ) : (
        <ul className="list-disc space-y-1.5 pl-4 text-sm text-ink">
          {points.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function VersionList({ skill }: { skill: Skill }) {
  const versions = [...skill.versions].sort((a, b) => b.version - a.version);
  return (
    <Section title="Versions">
      <ul className="-mx-2 space-y-1">
        {versions.map((version) => {
          const current = version.id === skill.id;
          return (
            <li key={version.id}>
              <Link
                href={`/dashboard/skills/${version.id}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "block rounded-[10px] px-2 py-2 text-sm",
                  current ? "bg-teal-soft text-teal" : "text-ink hover:bg-secondary",
                )}
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  Version {version.version}
                  {version.id === skill.latest_id ? (
                    <span className="text-xs font-normal text-ink-secondary">Newest</span>
                  ) : current ? (
                    <span className="text-xs font-normal text-ink-secondary">Viewing</span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-xs text-ink-secondary">
                  {formatDate(version.created_at)} · {plural(version.step_count, "step")} ·{" "}
                  {version.attempt_count === 0 ? "No recordings graded" : `${plural(version.attempt_count, "recording")} graded`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function ActionRow({
  icon,
  title,
  detail,
  href,
  onClick,
  disabled,
  danger,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const classes = cn(
    "flex w-full items-start gap-3 rounded-[10px] px-2 py-2 text-left text-sm transition-colors",
    disabled ? "cursor-not-allowed opacity-60" : "hover:bg-secondary",
  );
  const body = (
    <>
      <span className={cn("mt-0.5 shrink-0", danger ? "text-danger" : "text-teal")} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cn("block font-medium", danger ? "text-danger" : "text-ink")}>{title}</span>
        <span className="block text-xs text-ink-secondary">{detail}</span>
      </span>
    </>
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={classes}>
      {body}
    </button>
  );
}

/** Every way to change this skill besides editing it in place. */
export function ActionsCard({
  skill,
  rebuilding,
  onRebuild,
  onDelete,
}: {
  skill: Skill;
  rebuilding: boolean;
  onRebuild: () => void;
  onDelete: () => void;
}) {
  const canRebuild = Boolean(skill.video?.available);
  return (
    <Section title="Actions">
      <div className="-mx-2 space-y-1">
        <ActionRow
          icon={<RefreshCw className="h-4 w-4" />}
          title="Rebuild steps from the video"
          detail={
            rebuilding
              ? "A rebuild is running."
              : canRebuild
                ? "Writes the steps and criteria again, as a new version."
                : "Needs a reference video stored on this server."
          }
          onClick={onRebuild}
          disabled={!canRebuild || rebuilding}
        />
        <ActionRow
          icon={<Camera className="h-4 w-4" />}
          title="Record a new reference"
          detail="The new video becomes the next version of this skill."
          href={`/dashboard/skills/new?skill=${skill.id}`}
        />
        {skill.video ? (
          <ActionRow
            icon={<Activity className="h-4 w-4" />}
            title="Movement data for this video"
            detail="Balance and posture measured in the reference."
            href={`/dashboard/safety/videos/${skill.video.id}`}
          />
        ) : null}
        <ActionRow
          icon={<Trash2 className="h-4 w-4" />}
          title="Delete this version"
          detail="Also deletes the caregiver recordings graded against it."
          onClick={onDelete}
          danger
        />
      </div>
    </Section>
  );
}
