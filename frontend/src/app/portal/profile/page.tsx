"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Building2, CalendarClock, Mail, Pencil, ShieldCheck } from "lucide-react";
import { Avatar, Button, Card, ErrorNote, Field, Input, ProgressBar, Skeleton } from "@/components/ui";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { practiceHref, recommendedSkill } from "@/caregiver/skills";
import { api, errorMessage } from "@/lib/api";
import { useTitle } from "@/lib/hooks";
import type { User } from "@/lib/types";
import { APP_NAME } from "@/shared/brand";
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
  const { signOut } = useAuth();
  const { skills, counts, error, reload } = useCaregiver();
  const [editing, setEditing] = useState(false);
  const next = recommendedSkill(skills);

  return (
    <div className="space-y-5">
      {editing ? (
        <Card className="p-5">
          <NameEditor user={user} onDone={() => setEditing(false)} />
        </Card>
      ) : (
        <header className="flex items-center gap-4">
          <Avatar name={user.name} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-semibold tracking-tight text-navy">{user.name}</h1>
            {user.title ? <p className="text-sm text-ink-secondary">{user.title}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-10 shrink-0">
            <Pencil className="h-4 w-4" aria-hidden />
            Edit name
          </Button>
        </header>
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

      <div className="rounded-[12px] border border-border shadow-[var(--shadow-card)] bg-teal-soft p-5">
        <p className="text-sm leading-relaxed text-navy">
          {APP_NAME} is here to help you feel ready, not to test you. A nurse always makes the final call on every
          skill.
        </p>
      </div>

      <Button href={next ? practiceHref(next.id) : "/portal/skills"} size="xl" className="w-full">
        Continue practicing
      </Button>
      <Button variant="ghost" size="lg" className="w-full" onClick={() => void signOut()}>
        Sign out
      </Button>
    </div>
  );
}
