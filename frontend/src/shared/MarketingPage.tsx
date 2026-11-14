"use client";

import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { APP_NAME, APP_TAGLINE } from "./brand";
import { PublicHeader } from "./PublicHeader";
import { homeUrlFor, LOGIN_PATH, SIGNUP_PATH } from "./urls";

const steps = [
  {
    title: "Caregivers record the skill",
    copy: "A bed-to-wheelchair transfer, gait belt assistance, or assisted standing — on video, against a nurse-written checklist.",
  },
  {
    title: "AI timestamps missed safety steps",
    copy: "Movement is compared to a nurse-approved reference. A brake left unlocked shows up with the second it happened.",
  },
  {
    title: "A registered nurse decides",
    copy: "Approve the skill or request retraining. AI never certifies anyone before independent work.",
  },
];

const queue = [
  {
    name: "Sarah Johnson",
    skill: "Bed-to-wheelchair transfer",
    status: "Needs review",
    tone: "warning" as const,
  },
  {
    name: "Emily Davis",
    skill: "Assisted standing",
    status: "Safety concern",
    tone: "danger" as const,
  },
  {
    name: "Michael Brown",
    skill: "Gait belt assistance",
    status: "Passed",
    tone: "success" as const,
  },
];

const badge = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
};

function AccountActions({
  stacked = false,
  invert = false,
}: {
  stacked?: boolean;
  invert?: boolean;
}) {
  const primary = invert
    ? "bg-white text-navy hover:bg-teal-soft"
    : "bg-teal text-white shadow-[0_1px_2px_rgba(23,50,77,0.12)] hover:bg-teal-hover";
  const secondary = invert
    ? "text-white hover:bg-white/10"
    : "text-navy hover:bg-secondary";

  const { user } = useAuth();
  const wide = stacked ? "w-full sm:w-auto" : "";

  if (user) {
    return (
      <div className={`flex ${stacked ? "w-full flex-col sm:w-auto sm:flex-row" : "flex-wrap"} items-stretch gap-2 sm:items-center`}>
        <Link
          href={homeUrlFor(user.role)}
          className={`inline-flex h-12 items-center justify-center rounded-[12px] px-5 text-sm font-semibold transition-colors ${wide} ${primary}`}
        >
          {user.role === "nurse" ? "Open your dashboard" : "Open your portal"}
        </Link>
      </div>
    );
  }

  return (
    <div
      className={`flex ${stacked ? "w-full flex-col sm:w-auto sm:flex-row" : "flex-wrap"} items-stretch gap-2 sm:items-center`}
    >
      <Link
        href={SIGNUP_PATH}
        className={`inline-flex h-12 items-center justify-center rounded-[12px] px-5 text-sm font-semibold transition-colors ${wide} ${primary}`}
      >
        Create account
      </Link>
      <Link
        href={LOGIN_PATH}
        className={`inline-flex h-12 items-center justify-center rounded-[12px] px-4 text-sm font-semibold transition-colors ${wide} ${secondary}`}
      >
        Log in
      </Link>
    </div>
  );
}

export function MarketingPage() {
  const needsNurse = queue.filter((item) => item.tone !== "success").length;

  return (
    <div className="min-h-dvh bg-page text-ink">
      <PublicHeader />

      <main id="main">
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_78%_-8%,rgba(23,108,113,0.12),transparent_58%)]" />

          <div className="relative mx-auto grid max-w-[1120px] items-center gap-6 px-5 pb-10 pt-6 sm:gap-8 sm:px-6 sm:pb-14 sm:pt-8 md:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] md:gap-12 md:pb-20 md:pt-12">
            <div className="min-w-0 md:order-2">
              <h1 className="text-balance text-[1.85rem] font-semibold leading-[1.14] tracking-[-0.035em] text-navy sm:text-[2.6rem] sm:leading-[1.1] lg:text-[2.85rem] lg:leading-[1.08]">
                Know a caregiver is ready before they work independently.
              </h1>
              <p className="mt-3 hidden max-w-md text-[17px] leading-7 text-ink-secondary sm:mt-4 sm:block">
                {APP_NAME} helps nurses verify essential caregiving skills with
                AI-assisted video review — so safety issues surface before the first
                unsupervised shift.
              </p>

              <div className="mt-5 sm:mt-7">
                <AccountActions stacked />
              </div>
              <p className="mt-3 max-w-md text-sm leading-6 text-ink-secondary">
                A nurse still makes the call. AI findings are recommendations, not
                certifications.
              </p>
            </div>

            <div className="relative min-w-0 md:order-1">
              <div className="overflow-hidden rounded-[16px] border border-border bg-white shadow-[0_8px_28px_rgba(23,50,77,0.08)]">
                <div className="flex items-center gap-2 border-b border-border bg-navy px-4 py-3">
                  <span className="h-2 w-2 rounded-full bg-white/25" aria-hidden />
                  <span className="h-2 w-2 rounded-full bg-white/25" aria-hidden />
                  <span className="h-2 w-2 rounded-full bg-teal" aria-hidden />
                  <p className="ml-2 text-xs font-medium tracking-wide text-white/80">
                    Clinical review · {APP_NAME}
                  </p>
                </div>
                <div className="p-4">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-secondary">
                      Pending reviews
                    </p>
                    <p className="text-xs font-semibold text-warning">
                      {needsNurse} need a nurse
                    </p>
                  </div>
                  <ul className="divide-y divide-border">
                    {queue.map((item) => (
                      <li
                        key={item.name}
                        className="flex items-center justify-between gap-3 py-3 first:pt-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                          <p className="truncate text-xs text-ink-secondary">{item.skill}</p>
                        </div>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badge[item.tone]}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                          {item.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 rounded-[12px] border border-danger/20 bg-danger-bg px-3.5 py-3">
                    <p className="text-xs font-semibold text-danger">
                      Wheelchair brakes not locked · 0:04–0:09
                    </p>
                    <p className="mt-1 text-xs leading-5 text-ink-secondary">
                      Both brake levers stay up through the pivot. A nurse still makes the call.
                    </p>
                  </div>
                  <p className="mt-4 flex items-center gap-2 text-xs text-ink-secondary">
                    <CircleCheck className="h-3.5 w-3.5 text-teal" aria-hidden />
                    AI findings are recommendations, not certifications.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 border-t border-border bg-white">
          <div className="mx-auto max-w-[720px] px-5 py-16 sm:px-6 md:py-20">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] text-navy">
              How {APP_NAME} works
            </h2>
            <p className="mt-3 text-[15px] leading-7 text-ink-secondary">{APP_TAGLINE}</p>

            <ol className="mt-10 space-y-8">
              {steps.map((step, index) => (
                <li key={step.title} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4">
                  <span className="text-sm font-semibold tabular-nums text-teal">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold tracking-tight text-navy">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-ink-secondary">{step.copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="for-teams" className="scroll-mt-24 border-t border-border bg-navy text-white">
          <div className="mx-auto max-w-[720px] px-5 py-16 sm:px-6 md:py-20">
            <h2 className="text-3xl font-semibold tracking-[-0.03em]">A nurse still makes the call</h2>
            <p className="mt-4 text-[15px] leading-7 text-white/80">
              Open a side-by-side review, jump to flagged timestamps, and approve or request
              retraining. Caregivers practice against a checklist first. You remain the only
              person who can certify a skill.
            </p>
            <div className="mt-8">
              <AccountActions stacked invert />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-white pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-4 px-5 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-navy">{APP_NAME}</p>
            <p className="mt-1 max-w-sm text-sm text-ink-secondary">
              Built for home-care agencies. Nurses remain the certifying authority.
            </p>
          </div>
          <Link
            href={SIGNUP_PATH}
            className="inline-flex h-11 w-fit items-center text-sm font-semibold text-teal hover:text-teal-hover"
          >
            Create account
          </Link>
        </div>
      </footer>
    </div>
  );
}
