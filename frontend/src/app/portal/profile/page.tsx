"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Building2, CalendarClock, Mail, Pencil, ShieldCheck } from "lucide-react";
import { Avatar, Button, Card, ErrorNote, Field, Input, ProgressBar, Skeleton } from "@/components/ui";
import { PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { api, errorMessage } from "@/lib/api";
import { useTitle } from "@/lib/hooks";
import type { User } from "@/lib/types";
import { useAuth, useUser } from "@/shared/AuthProvider";

function NameEditor({ user, onDone }: { user: User; onDone: () => void }) {
  const { setUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Please add your name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api<User>("/auth/me", { method: "PATCH", json: { name: trimmed } });
      setUser(updated);
      onDone();
    } catch (problem) {
      setError(errorMessage(problem));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <Field label="Your name">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          maxLength={120}
          autoFocus
          className="h-12 text-base"
        />
      </Field>
      {error ? <ErrorNote message={error} /> : null}
      <div className="flex gap-2">
        <Button type="submit" size="lg" loading={saving} className="flex-1">
          Save name
        </Button>
        <Button variant="ghost" size="lg" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Building2; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-teal" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-secondary">{label}</p>
        {children}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  useTitle("Profile");
  const user = useUser();
  const { counts, error, reload } = useCaregiver();
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-5">
      <PortalHeading title="Profile" description="Your details and how far along you are." />

      {/* One column on a phone; on a laptop, who you are on the left and your progress on the right. */}
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="space-y-5">
          {editing ? (
            <Card className="p-5">
              <NameEditor user={user} onDone={() => setEditing(false)} />
            </Card>
          ) : (
            // A card on a laptop; on a phone it sits straight on the page, which leaves the name more room.
            <div className="flex items-center gap-4 lg:rounded-[12px] lg:border lg:border-border lg:bg-white lg:p-5 lg:shadow-[var(--shadow-card)]">
              <Avatar name={user.name} size="xl" />
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-xl font-semibold tracking-tight text-navy">{user.name}</h2>
                {user.title ? <p className="text-sm text-ink-secondary">{user.title}</p> : null}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-10 shrink-0">
                <Pencil className="h-4 w-4" aria-hidden />
                Edit name
              </Button>
            </div>
          )}

          <Card className="space-y-4 p-5">
            <Row icon={Building2} label="Agency">
              <p className="text-sm font-medium text-navy">{user.org.name}</p>
            </Row>
            <Row icon={Mail} label="Email">
              <p className="break-all text-sm font-medium text-navy">{user.email}</p>
            </Row>
            {user.next_shift ? (
              <Row icon={CalendarClock} label="Next shift">
                <p className="text-sm font-medium text-navy">{user.next_shift}</p>
              </Row>
            ) : null}
          </Card>
        </div>

        <Card className="p-5">
          <Row icon={ShieldCheck} label="Skills verified">
            {counts ? (
              <>
                <p className="text-sm font-medium tabular-nums text-navy">
                  {counts.verified} of {counts.total}
                  {counts.in_review > 0 ? ` · ${counts.in_review} with a nurse` : ""}
                </p>
                <ProgressBar className="mt-2" value={counts.verified} max={counts.total} label="Skills verified" />
              </>
            ) : error ? (
              <ErrorNote className="mt-1" message={error} onRetry={reload} />
            ) : (
              <Skeleton className="mt-1 h-8" />
            )}
          </Row>
        </Card>
      </div>
    </div>
  );
}
