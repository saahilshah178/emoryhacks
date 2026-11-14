"use client";

import { CircleCheck } from "lucide-react";
import { APP_NAME } from "./brand";
import { PublicHeader } from "./PublicHeader";

const steps = [
  {
    title: "Caregivers record the skill",
    copy: "A new caregiver watches a demonstration of an assigned skill, then records themselves attempting it.",
  },
  {
    title: "AI analyzes the video",
    copy: "The caregiver's attempt of the skill is compared to the demonstration video. Timestamps are provided with each step so the caregiver knows exactly where they went wrong.",
  },
  {
    title: "A nurse makes the final decision",
    copy: "Once the caregiver successfully performs a skill, the video is sent to a registered nurse for verification.",
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

/** The sample clinical review card shown under the hero text. */
function ReviewPreview() {
  const needsNurse = queue.filter((item) => item.tone !== "success").length;

  return (
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
          <p className="text-xs font-semibold text-warning">{needsNurse} need a nurse</p>
        </div>
        <ul className="divide-y divide-border">
          {queue.map((item) => (
            <li key={item.name} className="flex items-center justify-between gap-3 py-2 first:pt-1">
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
        <div className="mt-2.5 rounded-[12px] border border-danger/20 bg-danger-bg px-3.5 py-2.5">
          <p className="text-xs font-semibold text-danger">Wheelchair brakes not locked · 0:04–0:09</p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            Both brake levers stay up through the pivot.
          </p>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-ink-secondary">
          <CircleCheck className="h-3.5 w-3.5 text-teal" aria-hidden />
          AI findings are recommendations, not certifications.
        </p>
      </div>
    </div>
  );
}

/** The "how it works" banner on the right of the hero. */
function HowItWorks() {
  return (
    <aside
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="flex w-full flex-col rounded-[20px] border border-border bg-white px-5 py-6 shadow-[0_8px_28px_rgba(23,50,77,0.08)] sm:px-7 sm:py-7"
    >
      <div className="flex flex-1 flex-col">
        <h2 id="how-it-works-title" className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-navy">
          How {APP_NAME} works
        </h2>

        <ol className="mt-5 flex flex-1 flex-col gap-3">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="grid flex-1 grid-cols-[2.25rem_minmax(0,1fr)] content-center gap-x-4 rounded-[14px] border border-border bg-page p-4"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-teal text-sm font-semibold tabular-nums text-white">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="text-[17px] font-semibold tracking-tight text-navy">{step.title}</h3>
                <p className="mt-0.5 text-sm leading-[1.4rem] text-ink-secondary">{step.copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

export function MarketingPage() {
  return (
    <div className="min-h-dvh bg-page text-ink">
      <PublicHeader />

      <main id="main">
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_20%_-8%,rgba(23,108,113,0.12),transparent_58%)]" />

          <div className="relative mx-auto grid max-w-[1200px] items-start gap-8 px-5 pb-10 pt-6 sm:px-6 md:min-h-[calc(100dvh-4rem-1px)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:content-center md:items-stretch md:gap-10 md:py-6 lg:gap-14">
            <div className="min-w-0">
              <h1 className="text-balance text-[2.4rem] font-semibold leading-[1.04] tracking-[-0.035em] text-navy sm:text-[2.7rem] lg:text-[2.9rem]">
                Better Caregivers.
                <br />
                <em>Faster.</em>
              </h1>
              <p className="mt-3 max-w-lg text-[17px] leading-7 text-ink-secondary sm:mt-4">
                {APP_NAME} helps nurses efficiently train caregivers on essential healthcare skills
                via AI-assisted video review.
              </p>

              <div className="mt-5">
                <ReviewPreview />
              </div>
            </div>

            <div className="flex min-w-0">
              <HowItWorks />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
