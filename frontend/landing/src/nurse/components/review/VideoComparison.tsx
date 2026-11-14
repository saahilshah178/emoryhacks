"use client";

import { Pause, Play } from "lucide-react";
import { formatClock } from "@/nurse/lib/format";
import { cn } from "@/nurse/lib/cn";
import type { DetectedStep } from "@/nurse/lib/types";

function TransferScene({
  mode,
  time,
}: {
  mode: "caregiver" | "reference";
  time: number;
}) {
  const standing = time >= 18;
  const pivoting = time >= 26;
  const sitting = time >= 32;
  const brakesLocked = mode === "reference";
  const beltOn = time >= 9;
  const figureX = sitting ? 430 : pivoting ? 390 : standing ? 300 : 210;
  const figureY = sitting ? 168 : standing ? 118 : 150;
  const clientFill = mode === "reference" ? "#238C91" : "#17324D";

  return (
    <svg viewBox="0 0 560 280" className="h-full w-full">
      <rect width="560" height="280" fill={mode === "reference" ? "#123040" : "#1a3348"} />
      <rect x="0" y="210" width="560" height="70" fill="#0f2433" />
      <rect x="36" y="132" width="168" height="78" rx="10" fill="#2b4a63" />
      <rect x="48" y="118" width="144" height="22" rx="6" fill="#dce7ee" />
      <circle cx="58" cy="228" r="16" fill="#243746" />
      <circle cx="150" cy="228" r="16" fill="#243746" />
      <rect x="400" y="150" width="92" height="72" rx="12" fill="#eef3f6" />
      <rect x="392" y="222" width="108" height="10" rx="4" fill="#718096" />
      <circle cx="410" cy="236" r="12" fill="#243746" />
      <circle cx="482" cy="236" r="12" fill="#243746" />
      <rect
        x="488"
        y="186"
        width="10"
        height="28"
        rx="2"
        fill={brakesLocked ? "#21966B" : "#D9534F"}
      />
      <rect
        x="392"
        y="186"
        width="10"
        height="28"
        rx="2"
        fill={brakesLocked ? "#21966B" : "#D9534F"}
      />
      <g transform={`translate(${figureX} ${figureY})`}>
        <circle cx="0" cy="-28" r="12" fill="#f3d3c2" />
        <rect x="-11" y="-14" width="22" height="36" rx="8" fill={clientFill} />
        {beltOn && <rect x="-13" y="4" width="26" height="6" rx="2" fill="#D99A32" />}
        <rect x="-18" y="20" width="12" height="28" rx="4" fill="#243746" />
        <rect x="6" y="20" width="12" height="28" rx="4" fill="#243746" />
      </g>
      <g transform={`translate(${figureX - 46} ${figureY + 8})`}>
        <circle cx="0" cy="-26" r="11" fill="#e8c4ae" />
        <rect x="-12" y="-12" width="24" height="38" rx="8" fill="#238C91" />
        <rect x="-16" y="24" width="11" height="26" rx="4" fill="#17324D" />
        <rect x="4" y="24" width="11" height="26" rx="4" fill="#17324D" />
      </g>
      <text x="20" y="28" fill="#E6F3F2" fontSize="12" fontFamily="Inter, sans-serif">
        {mode === "reference" ? "Nurse reference" : "Caregiver demonstration"}
      </text>
      {!brakesLocked && mode === "caregiver" && time >= 4 && (
        <g>
          <rect x="360" y="24" width="180" height="28" rx="8" fill="#FCEDEC" />
          <text x="372" y="43" fill="#D9534F" fontSize="12" fontFamily="Inter, sans-serif">
            Brakes unlocked
          </text>
        </g>
      )}
    </svg>
  );
}

export function VideoComparison({
  currentTime,
  duration,
  playing,
  onToggle,
  onSeek,
  steps,
}: {
  currentTime: number;
  duration: number;
  playing: boolean;
  onToggle: () => void;
  onSeek: (time: number) => void;
  steps: DetectedStep[];
}) {
  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <section className="space-y-3">
      <div className="grid gap-4 xl:grid-cols-2">
        {(["caregiver", "reference"] as const).map((mode) => (
          <div
            key={mode}
            className="overflow-hidden rounded-[12px] border border-border bg-navy shadow-[var(--shadow-card)]"
          >
            <div className="aspect-video">
              <TransferScene mode={mode} time={currentTime} />
            </div>
            <div className="flex items-center justify-between bg-[#12283c] px-4 py-2 text-xs text-white/70">
              <span>{mode === "caregiver" ? "Submitted recording" : "Approved reference"}</span>
              <span>
                {formatClock(currentTime)} / {formatClock(duration)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-[12px] border border-border bg-white p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggle}
            className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-teal text-white hover:bg-teal-hover"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="relative h-8">
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={currentTime}
                onChange={(event) => onSeek(Number(event.target.value))}
                aria-label="Playback time"
                aria-valuetext={formatClock(currentTime)}
                className="absolute inset-0 z-10 h-8 w-full cursor-pointer appearance-none bg-transparent"
              />
              <div className="absolute top-1/2 h-2 w-full -translate-y-1/2 rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-teal"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {steps.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  title={`${step.label} · ${formatClock(step.timestamp)}`}
                  aria-label={`${step.label} at ${formatClock(step.timestamp)}, ${step.status.replace("_", " ")}`}
                  onClick={() => onSeek(step.timestamp)}
                  className={cn(
                    "absolute top-1/2 z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white",
                    step.status === "failed" && "bg-danger",
                    step.status === "needs_review" && "bg-warning",
                    step.status === "passed" && "bg-success",
                  )}
                  style={{ left: `${(step.timestamp / duration) * 100}%` }}
                />
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-secondary">
              Shared timeline. Markers: green passed, amber needs review, red failed.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
