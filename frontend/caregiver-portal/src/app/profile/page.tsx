"use client";

import { Building2, CalendarClock, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Button } from "@/components/ui/Button";
import { useCaregiver } from "@/context/CaregiverContext";
import { APP_NAME } from "@/config/branding";
import { getRecommendedSkill } from "@/data/skills";

export default function ProfilePage() {
  const { caregiver, skills, verifiedCount, awaitingCount } = useCaregiver();
  const nextSkill = getRecommendedSkill(skills);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-soft text-lg font-semibold text-navy ring-1 ring-border">
          {caregiver.avatarInitials}
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-navy">
            {caregiver.firstName} {caregiver.lastName}
          </h1>
          <p className="text-sm text-text-secondary">{caregiver.role}</p>
        </div>
      </header>

      <Card className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <Building2 className="mt-0.5 h-5 w-5 text-teal" aria-hidden />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Agency
            </p>
            <p className="text-sm font-medium text-navy">{caregiver.agency}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-5 w-5 text-teal" aria-hidden />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Next shift
            </p>
            <p className="text-sm font-medium text-navy">{caregiver.nextShift}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-teal" aria-hidden />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Skills verified
            </p>
            <p className="text-sm font-medium text-navy">
              {verifiedCount} of {skills.length}
              {awaitingCount > 0 ? ` · ${awaitingCount} with a nurse` : ""}
            </p>
            <ProgressBar
              className="mt-2"
              value={verifiedCount}
              max={skills.length}
              label="Skills verified"
            />
          </div>
        </div>
      </Card>

      <Card className="bg-teal-soft p-4">
        <p className="text-sm leading-relaxed text-navy">
          {APP_NAME} is here to help you feel ready — not to test you. A nurse
          always makes the final call on every skill.
        </p>
      </Card>

      <Button href={`/skills/${nextSkill.id}`} className="w-full">
        Continue practicing
      </Button>
    </div>
  );
}
