"use client";

import { CircleCheck, HeartPulse, ShieldCheck, Stethoscope, Video } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "./brand";
import { Logo } from "./Logo";
import { PublicHeader } from "./PublicHeader";

const steps = [
  {
    n: "01",
    icon: Video,
    title: "Record the skill",
    copy: "Caregivers demonstrate essential tasks on video — a bed-to-wheelchair transfer, gait belt assistance, assisted standing.",
  },
  {
    n: "02",
    icon: ShieldCheck,
    title: "AI reviews movement",
    copy: "Movement is compared to a nurse-approved reference. Missed safety steps are timestamped and flagged immediately.",
  },
  {
    n: "03",
    icon: Stethoscope,
    title: "A nurse decides",
    copy: "AI never certifies anyone. A registered nurse approves the skill or requests retraining before independent work.",
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
    name: "Michael Brown",
    skill: "Gait belt assistance",
    status: "Passed",
    tone: "success" as const,
  },
  {
    name: "Emily Davis",
    skill: "Assisted standing",
    status: "Safety concern",
    tone: "danger" as const,
  },
];

const badge = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
};

export function MarketingPage() {
  return (
    <div className="min-h-dvh bg-page text-ink">
      <PublicHeader />

      <main id="main">
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_78%_-8%,rgba(35,140,145,0.12),transparent_58%)]" />

          <div className="relative mx-auto grid max-w-[1120px] items-center gap-12 px-6 pb-16 pt-10 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)] md:gap-10 md:pb-20 md:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-14">
            <div className="min-w-0">
              <h1 className="text-balance text-[2.15rem] font-semibold leading-[1.14] tracking-[-0.035em] text-navy sm:text-[2.75rem] sm:leading-[1.1] lg:text-5xl lg:leading-[1.08]">
                Know a caregiver is ready before they work independently.
              </h1>
              <p className="mt-5 max-w-md text-[17px] leading-7 text-ink-secondary">
                {APP_NAME} helps nurses verify essential caregiving skills with
                AI-assisted video review — so safety issues surface before the first
                unsupervised shift.
              </p>

              <ul className="mt-10 grid gap-4 sm:grid-cols-3">
                {[
                  ["Nurse-final", "AI recommends. Nurses certify."],
                  ["Safety-first", "Critical misses stay visible."],
                  ["Shift-ready", "Verify before independent work."],
                ].map(([label, detail]) => (
                  <li key={label} className="border-t border-border pt-3">
                    <p className="text-sm font-semibold text-navy">{label}</p>
                    <p className="mt-1 text-xs leading-5 text-ink-muted">{detail}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative min-w-0">
              <div className="overflow-hidden rounded-[16px] border border-border bg-white shadow-[0_8px_28px_rgba(23,50,77,0.08)]">
                <div className="flex items-center gap-2 border-b border-border bg-navy px-4 py-3">
                  <span className="h-2 w-2 rounded-full bg-white/25" aria-hidden />
                  <span className="h-2 w-2 rounded-full bg-white/25" aria-hidden />
                  <span className="h-2 w-2 rounded-full bg-teal" aria-hidden />
                  <p className="ml-2 text-[11px] font-medium tracking-wide text-white/70">
                    Clinical review · {APP_NAME}
                  </p>
                </div>
                <div className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                      Pending reviews
                    </p>
                    <p className="text-[11px] font-medium text-warning">3 need a nurse</p>
                  </div>
                  <div className="space-y-2.5">
                    {queue.map((item) => (
                      <div
                        key={item.name}
                        className="flex items-center justify-between gap-3 rounded-[12px] border border-border bg-page px-3.5 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                          <p className="truncate text-xs text-ink-muted">{item.skill}</p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${badge[item.tone]}`}
                        >
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-[12px] border border-danger/15 bg-danger-bg px-3.5 py-3">
                    <p className="text-xs font-semibold text-danger">
                      Wheelchair brakes not locked — 0:04
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
          <div className="mx-auto max-w-[1120px] px-6 py-16 md:py-20">
            <div className="max-w-xl">
              <h2 className="text-3xl font-semibold tracking-[-0.03em] text-navy">
                How {APP_NAME} works
              </h2>
              <p className="mt-3 text-[15px] leading-7 text-ink-secondary">
                {APP_TAGLINE} A calm, clinical workflow — never an automatic pass.
              </p>
            </div>

            <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              {steps.map((step) => (
                <li key={step.n}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-teal-soft text-teal">
                      <step.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="text-xs font-semibold tracking-[0.16em] text-ink-muted">
                      {step.n}
                    </span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold tracking-tight text-navy">{step.title}</h3>
                  <p className="mt-2 max-w-prose text-sm leading-6 text-ink-secondary">{step.copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="for-teams" className="scroll-mt-24 border-t border-border bg-page">
          <div className="mx-auto grid max-w-[1120px] gap-6 px-6 py-16 md:grid-cols-2 md:py-20">
            <article className="rounded-[16px] border border-border bg-white p-8 shadow-[var(--shadow-card)]">
              <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-teal-soft text-teal">
                <HeartPulse className="h-5 w-5" />
              </span>
              <h2 className="mt-5 text-xl font-semibold tracking-tight text-navy">
                For caregivers
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">
                Practice with a clear checklist, record a demonstration, and see exactly which
                steps need another look — before a supervisor reviews your work.
              </p>
              <p className="mt-6 text-sm font-medium text-teal">Warm, guided, and specific.</p>
            </article>
            <article className="rounded-[16px] border border-border bg-navy p-8 text-white shadow-[var(--shadow-card)]">
              <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-teal text-white">
                <Stethoscope className="h-5 w-5" />
              </span>
              <h2 className="mt-5 text-xl font-semibold tracking-tight">For nurses</h2>
              <p className="mt-2 text-sm leading-6 text-white/75">
                Open a side-by-side review, jump to flagged timestamps, and approve or request
                retraining. You remain the only person who can certify a skill.
              </p>
              <p className="mt-6 text-sm font-medium text-teal-soft">Structured, quiet, and decisive.</p>
            </article>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-white">
        <div className="mx-auto max-w-[1120px] px-6 py-8">
          <Logo />
          <p className="mt-2 max-w-sm text-sm text-ink-muted">
            Built for home-care agencies. Nurses remain the certifying authority.
          </p>
        </div>
      </footer>
    </div>
  );
}
