"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { User } from "@/lib/types";
import { useAuth } from "./AuthProvider";

/**
 * A caregiver is connected once their agency has a nurse. Nurses are always in theirs.
 * An API from before join codes existed leaves `has_nurse` out; everyone it knows is connected.
 */
export function connectedToAgency(user: User) {
  return user.role !== "caregiver" || user.org.has_nurse !== false;
}

/** Agency name when connected; a plain status when a caregiver has not joined a nurse yet. */
export function agencyCaption(user: User) {
  return connectedToAgency(user) ? user.org.name : "Not connected";
}

/** `xxxx-xxxx`. Empty for an agency that has no code (an API from before join codes existed). */
export function formatJoinCode(code: string | null | undefined) {
  const given = code ?? "";
  const compact = given.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (compact.length === 8) return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  return given;
}

export function CopyJoinCode({ code }: { code: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  const display = formatJoinCode(code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button variant="secondary" size="sm" disabled={!display} onClick={() => void copy()}>
      {copied ? "Copied" : "Copy code"}
    </Button>
  );
}

/** The agency's join code, large enough to read aloud, with a copy button. */
export function AgencyCode({ code, className }: { code: string | null | undefined; className?: string }) {
  if (!code) return null;
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-3", className)}>
      <p className="text-[1.375rem] font-semibold tracking-[0.18em] text-navy">{formatJoinCode(code)}</p>
      <CopyJoinCode code={code} />
    </div>
  );
}

export function JoinAgencyForm({
  onJoined,
  className,
  label = "Agency code",
  hint,
  size = "md",
}: {
  onJoined?: (user: User) => void;
  className?: string;
  /** The field's name, for a page that also shows this agency's own code. */
  label?: string;
  hint?: string;
  size?: "md" | "lg";
}) {
  const { joinAgency } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Enter the agency code you were given.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const user = await joinAgency(trimmed);
      setCode("");
      onJoined?.(user);
    } catch (failure) {
      // An API from before join codes existed has no such route.
      const missing = failure instanceof ApiError && failure.status === 404;
      setError(missing ? "Agencies can't be joined here yet. Please try again later." : errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={className}>
      <Field label={label} hint={hint}>
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="xxxx-xxxx"
          className={size === "lg" ? "h-12 tracking-widest text-base" : "h-11 tracking-widest"}
        />
      </Field>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" size={size} className={size === "lg" ? "mt-3 w-full" : "mt-3"} loading={busy} disabled={!code.trim()}>
        Join agency
      </Button>
    </form>
  );
}
