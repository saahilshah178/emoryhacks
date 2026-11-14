"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, CardBody, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useUser } from "@/shared/AuthProvider";
import { MIN_PASSWORD } from "@/shared/password";

type Outcome = { ok: boolean; message: string } | null;

/**
 * Change the signed-in person's password (POST /auth/password). The current password has
 * to be entered too: the API refuses the change without it, so a session left open on a
 * shared device is not enough to take the account over.
 */
export function ChangePasswordCard({ className }: { className?: string }) {
  const user = useUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const type = visible ? "text" : "password";

  function fail(message: string) {
    setOutcome({ ok: false, message });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!current) return fail("Enter your current password.");
    if (next.length < MIN_PASSWORD) return fail(`Choose a new password of at least ${MIN_PASSWORD} characters.`);
    if (next !== again) return fail("The two new passwords don't match.");
    if (next === current) return fail("Choose a new password that is different from your current one.");

    setSaving(true);
    setOutcome(null);
    try {
      await api("/auth/password", { method: "POST", json: { current_password: current, new_password: next } });
      setCurrent("");
      setNext("");
      setAgain("");
      setOutcome({ ok: true, message: "Password changed. Any other device signed in to your account has been signed out." });
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  /** Editing a field clears the last message, so an old error does not sit beside a new attempt. */
  function edit(set: (value: string) => void) {
    return (event: { target: { value: string } }) => {
      set(event.target.value);
      setOutcome(null);
    };
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Enter your current password, then choose a new one.</CardDescription>
        </div>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {/* Tells a password manager which account these passwords belong to. */}
          <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
          <Field label="Current password">
            <Input
              type={type}
              name="current-password"
              autoComplete="current-password"
              value={current}
              onChange={edit(setCurrent)}
              className="h-12 text-base"
            />
          </Field>
          <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
            <Input
              type={type}
              name="new-password"
              autoComplete="new-password"
              value={next}
              onChange={edit(setNext)}
              className="h-12 text-base"
            />
          </Field>
          <Field label="New password again">
            <Input
              type={type}
              name="new-password-again"
              autoComplete="new-password"
              value={again}
              onChange={edit(setAgain)}
              className="h-12 text-base"
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={visible}
              onChange={(event) => setVisible(event.target.checked)}
              className="h-4 w-4 accent-teal"
            />
            Show passwords
          </label>
          {outcome ? (
            <p
              role={outcome.ok ? "status" : "alert"}
              className={
                outcome.ok
                  ? "rounded-[12px] bg-success-bg px-4 py-3 text-sm text-success"
                  : "rounded-[12px] bg-danger-bg px-4 py-3 text-sm text-danger"
              }
            >
              {outcome.message}
            </p>
          ) : null}
          <Button type="submit" size="lg" loading={saving} className="w-full lg:w-auto">
            Change password
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
