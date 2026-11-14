"use client";

import { Building2, CalendarClock, ShieldCheck } from "lucide-react";
import { Card } from "@/caregiver/components/ui/Card";
import { ProgressBar } from "@/caregiver/components/ui/ProgressBar";
import { Button } from "@/caregiver/components/ui/Button";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { APP_NAME } from "@/config/branding";
import { getRecommendedSkill } from "@/caregiver/data/skills";
import { useAuth } from "@/shared/AuthProvider";

export default function ProfilePage() {
  const { signOut } = useAuth();
  const { caregiver, skills, verifiedCount, awaitingCount } = useCaregiver();
  const nextSkill = getRecommendedSkill(skills);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-soft text-lg font-semibold text-navy">
          {caregiver.avatarInitials}
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy">
            {caregiver.firstName} {caregiver.lastName}
          </h1>
          <p className="text-sm text-ink-secondary">{caregiver.role}</p>
        </div>
      </header>

      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <Building2 className="mt-0.5 h-5 w-5 text-teal" aria-hidden />
          <div>
            <p className="text-sm text-ink-secondary">Agency</p>
            <p className="text-sm font-medium text-navy">{caregiver.agency}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-5 w-5 text-teal" aria-hidden />
          <div>
            <p className="text-sm text-ink-secondary">Next shift</p>
            <p className="text-sm font-medium text-navy">{caregiver.nextShift}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-teal" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-secondary">Skills verified</p>
            <p className="text-sm font-medium tabular-nums text-navy">
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

      <Card className="bg-teal-soft p-5">
        <p className="text-sm leading-relaxed text-navy">
          {APP_NAME} is here to help you feel ready — not to test you. A nurse
          always makes the final call on every skill.
        </p>
      </Card>

      <Button href={`/portal/skills/${nextSkill.id}`} className="w-full">
        Continue practicing
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
