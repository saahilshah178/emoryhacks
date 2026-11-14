"use client";

import { useState } from "react";
import { Button } from "@/nurse/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/nurse/components/ui/Card";
import { Input } from "@/nurse/components/ui/Input";
import { APP_NAME } from "@/nurse/lib/branding";
import { CURRENT_NURSE } from "@/nurse/lib/mock-data";
import { useAuth } from "@/shared/AuthProvider";

export default function SettingsPage() {
  const { signOut } = useAuth();
  const [name, setName] = useState(CURRENT_NURSE.name);
  const [alerts, setAlerts] = useState({
    safety: true,
    submissions: true,
    digest: false,
  });
  const [saved, setSaved] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <p className="text-sm text-ink-secondary">
        Workspace preferences for {APP_NAME}.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Nurse profile</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Display name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Credentials</span>
            <Input defaultValue={CURRENT_NURSE.credentials} readOnly />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Agency</span>
            <Input defaultValue={CURRENT_NURSE.agency} readOnly />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Product name</span>
            <Input defaultValue={APP_NAME} readOnly />
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notification preferences</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {(
            [
              ["safety", "Email me when AI raises a safety flag"],
              ["submissions", "Notify me of new skill submissions"],
              ["digest", "Send a weekly verification digest"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-3 rounded-[12px] bg-page px-4 py-3">
              <span className="text-sm text-ink">{label}</span>
              <input
                type="checkbox"
                checked={alerts[key]}
                onChange={(event) =>
                  setAlerts((current) => ({ ...current, [key]: event.target.checked }))
                }
                className="h-4 w-4 accent-teal"
              />
            </label>
          ))}
          <Button
            onClick={() => {
              setSaved(true);
              window.setTimeout(() => setSaved(false), 2500);
            }}
          >
            Save preferences
          </Button>
          {saved && <p className="text-sm text-success">Preferences saved on this device.</p>}
          <Button type="button" variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
