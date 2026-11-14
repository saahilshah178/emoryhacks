"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import { APP_NAME } from "./brand";
import { Logo } from "./Logo";
import { homeUrlFor, SIGNUP_PATH } from "./urls";

/**
 * The login page. Agency logins use a username; an account created on the sign-up
 * page can use that username or the email it was created with.
 */
export function LoginForm() {
  const router = useRouter();
  const { ready, user, signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Someone who is already signed in has no use for this page.
  useEffect(() => {
    if (ready && user) router.replace(homeUrlFor(user.role));
  }, [ready, user, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim()) {
      setError("Enter your username or email.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const account = await signIn(username.trim(), password);
      router.replace(homeUrlFor(account.role));
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <header className="sticky top-0 z-30 border-b border-border bg-white">
        <div className="flex h-16 items-center px-6">
          <Logo />
        </div>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-navy">{`Log in to ${APP_NAME}`}</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Use your username or email, and your password. You&apos;ll go straight to your own workspace.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
          <Field label="Username or email">
            <Input
              className="h-11"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Your username or email"
            />
          </Field>

          <Field label="Password">
            <Input
              className="h-11"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Your password"
            />
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Log in
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-secondary">
          Need an account?{" "}
          <Link href={SIGNUP_PATH} className="font-semibold text-teal hover:underline">
            Create account
          </Link>
        </p>
      </main>
    </div>
  );
}
