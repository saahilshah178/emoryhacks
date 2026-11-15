"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Loadable,
  ProgressBar,
  Skeleton,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useApi, useTitle } from "@/lib/hooks";
import type { Health, Prefs, User } from "@/lib/types";
import { PageHeading } from "@/shared/layout/PageHeading";
import { useDashboard } from "@/nurse/context/DashboardContext";
import { useAuth, useUser } from "@/shared/AuthProvider";
import { CopyJoinCode, formatJoinCode, JoinAgencyForm } from "@/shared/JoinAgency";

type Outcome = { ok: boolean; message: string } | null;

/** "Saved" or the reason it failed, next to the button. */
function SaveNote({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;
  return (
    <p role={outcome.ok ? "status" : "alert"} className={outcome.ok ? "text-sm text-success" : "text-sm text-danger"}>
      {outcome.message}
    </p>
  );
}

/** Runs a save and reports how it went. */
function useSave() {
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  async function run(action: () => Promise<void>, success: string) {
    setSaving(true);
    setOutcome(null);
    try {
      await action();
      setOutcome({ ok: true, message: success });
    } catch (error) {
      setOutcome({ ok: false, message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }
  return { saving, outcome, run, clear: () => setOutcome(null) };
}

export default function SettingsPage() {
  useTitle("Settings");
  const { signOut } = useAuth();

  return (
    <div className="space-y-5">
      <PageHeading title="Settings" description="Your profile, your agency and how the system is running." />
      {/* Two columns of cards on wide screens, so the forms span the page without stretching. */}
      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <div className="space-y-5">
          <ProfileCard />
          <AgencyCard />
        </div>
        <div className="space-y-5">
          <NotificationsCard />
          <SystemCard />
        </div>
      </div>
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3 pt-5">
          <div>
            <p className="text-sm font-semibold text-ink">Sign out</p>
            <p className="text-sm text-ink-secondary">End your session on this device.</p>
          </div>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

function ProfileCard() {
  const user = useUser();
  const { setUser } = useAuth();
  const [form, setForm] = useState({ name: user.name, credentials: user.credentials, title: user.title });
  const { saving, outcome, run, clear } = useSave();
  const changed =
    form.name.trim() !== user.name || form.credentials.trim() !== user.credentials || form.title.trim() !== user.title;

  function edit(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    clear();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const updated = await api<User>("/auth/me", {
        method: "PATCH",
        json: { name: form.name.trim(), credentials: form.credentials.trim(), title: form.title.trim() },
      });
      setUser(updated);
      setForm({ name: updated.name, credentials: updated.credentials, title: updated.title });
    }, "Profile saved.");
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Nurse profile</CardTitle>
          <CardDescription>Shown in the top bar and next to every decision you record.</CardDescription>
        </div>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Display name">
            <Input value={form.name} onChange={(event) => edit("name", event.target.value)} autoComplete="name" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Credentials" hint="For example RN or LPN.">
              <Input value={form.credentials} maxLength={40} onChange={(event) => edit("credentials", event.target.value)} />
            </Field>
            <Field label="Job title" hint="For example Clinical supervisor.">
              <Input value={form.title} maxLength={80} onChange={(event) => edit("title", event.target.value)} />
            </Field>
          </div>
          <Field label="Username" hint="You sign in with this. It cannot be changed here.">
            <Input value={user.username ?? ""} readOnly />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={saving} disabled={!changed || form.name.trim().length < 2}>
              Save profile
            </Button>
            <SaveNote outcome={outcome} />
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function AgencyCard() {
  const user = useUser();
  const { setUser } = useAuth();
  const { reloadOverview } = useDashboard();
  // The name being typed. Null shows the saved one, so the field follows the agency when
  // this nurse joins another.
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? user.org.name;
  const { saving, outcome, run, clear } = useSave();
  const changed = name.trim() !== user.org.name;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const updated = await api<User>("/org", { method: "PATCH", json: { name: name.trim() } });
      setUser(updated);
      setDraft(null);
      reloadOverview();
    }, "Agency name saved.");
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Agency</CardTitle>
          <CardDescription>
            Everyone in your agency sees this name. Share the code so caregivers and other nurses can join.
          </CardDescription>
        </div>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Agency name">
            <Input
              value={name}
              maxLength={120}
              onChange={(event) => {
                setDraft(event.target.value);
                clear();
              }}
              required
            />
          </Field>
          {user.org.join_code ? (
            // Laid out like a Field, but the copy button stays outside the label.
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Agency code</p>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  aria-label="Agency code"
                  value={formatJoinCode(user.org.join_code)}
                  readOnly
                  className="max-w-[12rem] tracking-[0.18em]"
                />
                <CopyJoinCode code={user.org.join_code} />
              </div>
              <p className="mt-1 text-xs text-ink-secondary">
                Share this with caregivers and other nurses so they can join.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={saving} disabled={!changed || name.trim().length < 2}>
              Save agency name
            </Button>
            <SaveNote outcome={outcome} />
          </div>
        </form>
        {/* An API from before join codes existed sends no code and cannot move anyone. */}
        <div className={user.org.join_code ? "mt-6 border-t border-border pt-5" : "hidden"}>
          <JoinAgencyForm
            label="Another agency's code"
            hint="Joining moves you into that agency. You can only do this while this agency has no skills and no other people."
            onJoined={() => {
              setDraft(null);
              clear();
              reloadOverview();
            }}
          />
        </div>
      </CardBody>
    </Card>
  );
}

const prefOptions: Array<{ key: keyof Prefs; label: string; hint: string }> = [
  {
    key: "safety",
    label: "Show safety concerns that need review",
    hint: "A submission with a safety flag that is waiting for a nurse.",
  },
  {
    key: "submissions",
    label: "Show new submissions",
    hint: "A submission without safety flags that is ready for review.",
  },
  {
    key: "digest",
    label: "Show a weekly verification digest",
    hint: "How many skills were approved this week and how many are still waiting.",
  },
];

function NotificationsCard() {
  const user = useUser();
  const { setUser } = useAuth();
  const { reloadOverview } = useDashboard();
  const [prefs, setPrefs] = useState<Prefs>(user.prefs);
  const { saving, outcome, run, clear } = useSave();
  const changed = prefOptions.some(({ key }) => prefs[key] !== user.prefs[key]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const updated = await api<User>("/auth/me", { method: "PATCH", json: { prefs } });
      setUser(updated);
      setPrefs(updated.prefs);
      reloadOverview();
    }, "Preferences saved.");
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Notification preferences</CardTitle>
          <CardDescription>
            Choose what appears under the bell in the top bar. Notifications stay in the dashboard; no emails are
            sent.
          </CardDescription>
        </div>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-3">
          {prefOptions.map(({ key, label, hint }) => (
            <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-[12px] bg-page px-4 py-3">
              <span>
                <span className="block text-sm text-ink">{label}</span>
                <span className="block text-xs text-ink-secondary">{hint}</span>
              </span>
              <input
                type="checkbox"
                checked={prefs[key]}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setPrefs((current) => ({ ...current, [key]: checked }));
                  clear();
                }}
                className="h-4 w-4 shrink-0 accent-teal"
              />
            </label>
          ))}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" loading={saving} disabled={!changed}>
              Save preferences
            </Button>
            <SaveNote outcome={outcome} />
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-ink-secondary">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}

const number = new Intl.NumberFormat("en-US");
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function SystemCard() {
  const health = useApi<Health>("/health");

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>System</CardTitle>
          <CardDescription>Where your data is kept and which AI models read the recordings.</CardDescription>
        </div>
      </CardHeader>
      <CardBody>
        <Loadable
          data={health.data}
          error={health.error}
          loading={health.loading}
          reload={health.reload}
          skeleton={<Skeleton className="h-48" />}
        >
          {({ database, gemini }) => (
            <>
              {gemini.fake_ai ? (
                <p className="mb-3 rounded-[12px] border border-warning/20 bg-warning-bg px-4 py-3 text-sm text-warning">
                  The AI is switched off on this server, so every assessment is canned sample output, not a real
                  reading of the video.
                </p>
              ) : !gemini.key_set ? (
                <p className="mb-3 rounded-[12px] border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
                  No AI key is set on this server, so new recordings cannot be assessed.
                </p>
              ) : gemini.problem ? (
                <p role="alert" className="mb-3 rounded-[12px] border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
                  {gemini.problem}
                </p>
              ) : null}
              <dl className="divide-y divide-border">
                <Row label="Database">
                  {database.tiger_cloud ? "Tiger Cloud" : "Local database"}
                  {database.timescaledb ? ` · TimescaleDB ${database.timescaledb}` : " · TimescaleDB not installed"}
                </Row>
                <Row label="Stored, all agencies">
                  {number.format(database.skills)} skill {database.skills === 1 ? "version" : "versions"} ·{" "}
                  {number.format(database.attempts)} {database.attempts === 1 ? "caregiver recording" : "caregiver recordings"} ·{" "}
                  {number.format(database.pose_frames)} movement readings
                </Row>
                <Row label="AI models">
                  {gemini.model_main}
                  <span className="text-ink-secondary"> for most of the work; </span>
                  {gemini.model_strong}
                  <span className="text-ink-secondary"> to double-check uncertain steps</span>
                </Row>
                <Row label="AI spend so far">
                  <span>
                    {dollars.format(gemini.spent_usd)} of {dollars.format(gemini.budget_usd)} budget
                  </span>
                  <ProgressBar
                    className="mt-2 max-w-sm"
                    value={gemini.spent_usd}
                    max={gemini.budget_usd}
                    label="AI spend against budget"
                    barClassName={gemini.spent_usd >= gemini.budget_usd * 0.9 ? "bg-danger!" : undefined}
                  />
                </Row>
              </dl>
            </>
          )}
        </Loadable>
      </CardBody>
    </Card>
  );
}
