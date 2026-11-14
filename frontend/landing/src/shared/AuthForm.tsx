"use client";

import { useState, type FormEvent } from "react";
import { HeartPulse, Stethoscope } from "lucide-react";
import { APP_NAME } from "./brand";
import { demoUser } from "./AuthProvider";
import { Logo } from "./Logo";
import { writeSession } from "./session";
import { homeUrlFor, LOGIN_PATH, SIGNUP_PATH, type Role } from "./urls";

const roles: Array<{ id: Role; title: string; subtitle: string; icon: typeof Stethoscope }> = [
  {
    id: "caregiver",
    title: "Caregiver portal",
    subtitle: "Record skills and track nurse feedback.",
    icon: HeartPulse,
  },
  {
    id: "nurse",
    title: "Clinical dashboard",
    subtitle: "Review submissions and approve competencies.",
    icon: Stethoscope,
  },
];

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [role, setRole] = useState<Role>("caregiver");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const isSignup = mode === "signup";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || password.trim().length < 4) {
      setError("Enter an email and a password of at least 4 characters.");
      return;
    }
    if (isSignup && name.trim().length < 2) {
      setError("Please add your name.");
      return;
    }
    const session = {
      role,
      email: email.trim(),
      name: isSignup ? name.trim() : role === "nurse" ? "Patricia Chen" : "Sarah Chen",
    };
    writeSession(session);
    window.location.assign(homeUrlFor(session.role));
  }

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <header className="sticky top-0 z-30 border-b border-border bg-white">
        <div className="flex h-16 items-center px-6">
          <Logo />
        </div>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-navy">
          {isSignup ? `Join ${APP_NAME}` : `Log in to ${APP_NAME}`}
        </h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Choose where you work, then continue. This demo signs you in locally — a nurse still
          makes every competency decision.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">I am signing in as</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {roles.map((item) => {
                const selected = role === item.id;
                const Icon = item.icon;
                return (
                  <label
                    key={item.id}
                    className={`cursor-pointer rounded-[12px] border p-4 transition-colors focus-within:ring-2 focus-within:ring-teal/25 ${
                      selected
                        ? "border-teal bg-teal-soft"
                        : "border-border bg-white hover:border-teal/40"
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
                      <Icon
                        className={`h-4 w-4 shrink-0 ${selected ? "text-teal" : "text-ink-muted"}`}
                        aria-hidden
                      />
                      <p className="text-sm font-semibold text-navy">{item.title}</p>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{item.subtitle}</p>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {isSignup && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Full name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-11 w-full rounded-[12px] border border-border bg-white px-3 text-sm text-ink outline-none placeholder:text-ink-secondary focus:border-teal focus:ring-2 focus:ring-teal/20"
                placeholder="Your name"
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 w-full rounded-[12px] border border-border bg-white px-3 text-sm text-ink outline-none placeholder:text-ink-secondary focus:border-teal focus:ring-2 focus:ring-teal/20"
              placeholder="you@agency.example"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-[12px] border border-border bg-white px-3 text-sm text-ink outline-none placeholder:text-ink-secondary focus:border-teal focus:ring-2 focus:ring-teal/20"
              placeholder="At least 4 characters"
            />
          </label>

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="inline-flex h-12 w-full items-center justify-center rounded-[12px] bg-teal text-sm font-semibold text-white hover:bg-teal-hover"
          >
            {isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        <div className="mt-6 rounded-[12px] border border-border bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Demo access</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                const session = demoUser("caregiver");
                writeSession(session);
                window.location.assign(homeUrlFor(session.role));
              }}
              className="h-11 rounded-[12px] border border-border text-sm font-medium text-navy transition-colors hover:bg-teal-soft"
            >
              Continue as caregiver
            </button>
            <button
              type="button"
              onClick={() => {
                const session = demoUser("nurse");
                writeSession(session);
                window.location.assign(homeUrlFor(session.role));
              }}
              className="h-11 rounded-[12px] border border-border text-sm font-medium text-navy transition-colors hover:bg-teal-soft"
            >
              Continue as nurse
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-ink-secondary">
          {isSignup ? "Already have an account?" : "Need an account?"}{" "}
          <a
            href={isSignup ? LOGIN_PATH : SIGNUP_PATH}
            className="font-semibold text-teal hover:underline"
          >
            {isSignup ? "Log in" : "Create account"}
          </a>
        </p>
      </main>
    </div>
  );
}
