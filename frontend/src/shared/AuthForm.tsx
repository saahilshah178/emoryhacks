"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HeartPulse, Stethoscope } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import { APP_NAME } from "./brand";
import { Logo } from "./Logo";
import { MIN_PASSWORD } from "./password";
import { homeUrlFor, LOGIN_PATH, SIGNUP_PATH, type Role } from "./urls";
import { LivelyBackground } from "@/shared/LivelyBackground";

const roles: Array<{ id: Role; title: string; subtitle: string; icon: typeof Stethoscope }> = [
  {
    id: "caregiver",
    title: "Caregiver",
    subtitle: "Record skills and track nurse feedback.",
    icon: HeartPulse,
  },
  {
    id: "nurse",
    title: "Nurse",
    subtitle: "Review submissions and approve competencies.",
    icon: Stethoscope,
  },
];

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const { ready, user, signIn, signUp } = useAuth();
  const [role, setRole] = useState<Role>("caregiver");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";

  // Someone who is already signed in has no use for this page.
  useEffect(() => {
    if (ready && user) router.replace(homeUrlFor(user.role));
  }, [ready, user, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSignup && name.trim().length < 2) {
      setError("Please add your name.");
      return;
    }
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    if (isSignup && password.length < MIN_PASSWORD) {
      setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const account = isSignup
        ? await signUp({
            role,
            name: name.trim(),
            email: email.trim(),
            password,
            ...(joinCode.trim() ? { join_code: joinCode.trim() } : {}),
          })
        : await signIn(email.trim(), password);
      router.replace(homeUrlFor(account.role));
    } catch (failure) {
      // An API from before sign-up existed has no such route.
      const missing = isSignup && failure instanceof ApiError && failure.status === 404;
      setError(missing ? "Accounts can't be created here yet. Please try again later." : errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-page">
      <LivelyBackground />
      <header className="chrome-bar chrome-bar-fade sticky top-0 z-30 border-b border-border">
        <div className="flex h-16 items-center px-6">
          <Logo light />
        </div>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-navy">
          {isSignup ? `Join ${APP_NAME}` : `Log in to ${APP_NAME}`}
        </h1>
        <p className="mt-2 text-sm text-ink-secondary">
          {isSignup
            ? "Tell us how you work, then create your account. If a nurse gave you an agency code, enter it so you join theirs."
            : "Use the email and password for your account. You'll go straight to your own workspace."}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
          {isSignup && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink">I am signing up as a</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {roles.map((item) => {
                  const selected = role === item.id;
                  const Icon = item.icon;
                  return (
                    <label
                      key={item.id}
                      className={`cursor-pointer rounded-[12px] border p-4 transition-colors focus-within:ring-2 focus-within:ring-teal/25 ${
                        selected ? "border-teal bg-teal-soft" : "border-border bg-white hover:border-teal/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={item.id}
                        checked={selected}
                        onChange={() => setRole(item.id)}
                        className="sr-only"
                      />
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 shrink-0 ${selected ? "text-teal" : "text-ink-muted"}`} aria-hidden />
                        <p className="text-sm font-semibold text-navy">{item.title}</p>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{item.subtitle}</p>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {isSignup && (
            <Field label="Full name">
              <Input
                className="h-11"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                placeholder="Your name"
              />
            </Field>
          )}

          <Field label="Email">
            <Input
              className="h-11"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@agency.example"
            />
          </Field>

          <Field label="Password">
            <Input
              className="h-11"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder={isSignup ? `At least ${MIN_PASSWORD} characters` : "Your password"}
            />
          </Field>

          {isSignup ? (
            <Field
              label="Agency code"
              hint={
                role === "nurse"
                  ? "Optional. Enter a code to join an existing agency instead of starting a new one."
                  : "Optional. Ask your nurse for their code to join their agency."
              }
            >
              <Input
                className="h-11 tracking-widest"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="xxxx-xxxx"
              />
            </Field>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {isSignup ? "Create account" : "Log in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-secondary">
          {isSignup ? "Already have an account?" : "Need an account?"}{" "}
          <Link href={isSignup ? LOGIN_PATH : SIGNUP_PATH} className="font-semibold text-teal hover:underline">
            {isSignup ? "Log in" : "Create account"}
          </Link>
        </p>
      </main>
    </div>
  );
}
