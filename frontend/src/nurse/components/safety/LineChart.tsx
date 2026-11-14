"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { cn } from "@/lib/cn";
import type { ChartSeries } from "./movement";

export type Band = { from: number; to: number; label: string; tone: "warning" | "danger" };
export type Shade = { start: number; end: number | null };

const BAND_FILL: Record<Band["tone"], { fill: string; opacity: number; text: string }> = {
  warning: { fill: "var(--warning)", opacity: 0.1, text: "var(--warning)" },
  danger: { fill: "var(--danger)", opacity: 0.08, text: "var(--danger)" },
};

const MARGIN = { left: 40, right: 12, top: 22, bottom: 40 };

/** Tick values from lo to hi, at a step from `steps` that leaves room for about `count` ticks. */
export function niceTicks(lo: number, hi: number, count: number, steps: number[]) {
  const span = Math.max(1e-9, hi - lo);
  const step = steps.find((s) => span / s <= Math.max(1, count)) ?? steps[steps.length - 1];
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** Follows an element's width, so charts are drawn at their real size (text stays readable). */
function useWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((previous) => (Math.abs(previous - next) >= 1 ? next : previous));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * A small inline-SVG line chart. Nulls break a line; a lone reading is drawn as a dot.
 * Bands shade a range of values (thresholds), shades a range of x (flagged stretches).
 * With onSeek, clicking the plot reports the x value under the pointer.
 */
export function LineChart({
  label,
  series,
  xDomain,
  formatX,
  xTicks,
  xTickSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200],
  xLabel,
  yDomain,
  yTicks,
  formatY = (v) => String(v),
  yLabel,
  bands = [],
  shades = [],
  shadeLabel,
  playhead,
  onSeek,
  height = 200,
  showPoints = false,
  empty = "No readings to show.",
  className,
}: {
  /** Accessible summary of what the chart shows. */
  label: string;
  series: ChartSeries[];
  xDomain: [number, number];
  formatX: (x: number) => string;
  xTicks?: number[];
  xTickSteps?: number[];
  xLabel: string;
  yDomain: [number, number];
  yTicks: number[];
  formatY?: (y: number) => string;
  yLabel: string;
  bands?: Band[];
  shades?: Shade[];
  shadeLabel?: string;
  playhead?: number | null;
  onSeek?: (x: number) => void;
  height?: number;
  showPoints?: boolean;
  empty?: string;
  className?: string;
}) {
  const { ref, width } = useWidth();
  const hasData = series.some((s) => s.points.some((p) => p.v !== null));

  const [x0, x1] = xDomain[1] > xDomain[0] ? xDomain : [xDomain[0], xDomain[0] + 1];
  const [y0, y1] = yDomain;
  const plotW = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(10, height - MARGIN.top - MARGIN.bottom);
  const x = (v: number) => MARGIN.left + ((v - x0) / (x1 - x0)) * plotW;
  const y = (v: number) => MARGIN.top + (1 - (Math.min(y1, Math.max(y0, v)) - y0) / (y1 - y0)) * plotH;
  const ticks = xTicks ?? niceTicks(x0, x1, Math.floor(plotW / 70), xTickSteps);

  function seek(event: MouseEvent<SVGSVGElement>) {
    if (!onSeek) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const value = x0 + ((px - MARGIN.left) / plotW) * (x1 - x0);
    onSeek(Math.min(x1, Math.max(x0, value)));
  }

  const legend = uniqueLegend(series);

  return (
    <div className={cn("min-w-0", className)}>
      <div ref={ref} className="w-full" style={{ height: hasData ? height : Math.min(height, 120) }}>
        {!hasData ? (
          <div className="flex h-full items-center justify-center rounded-[12px] border border-dashed border-border bg-page px-6 text-center text-sm text-ink-secondary">
            {empty}
          </div>
        ) : width > 0 ? (
          <svg
            role="img"
            aria-label={label}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            onClick={seek}
            className={cn("block", onSeek && "cursor-pointer")}
          >
            <title>{label}</title>
            {/* threshold bands */}
            {bands.map((band) => {
              const top = y(band.to);
              const bottom = y(band.from);
              const style = BAND_FILL[band.tone];
              return (
                <g key={`${band.from}-${band.to}`}>
                  <rect x={MARGIN.left} y={top} width={plotW} height={Math.max(1, bottom - top)} fill={style.fill} opacity={style.opacity} />
                  <text x={MARGIN.left + plotW - 4} y={top + 11} textAnchor="end" fontSize={10} fontWeight={600} fill={style.text}>
                    {band.label}
                  </text>
                </g>
              );
            })}
            {/* flagged stretches */}
            {shades.map((shade, i) => {
              const start = x(Math.max(x0, shade.start));
              const end = x(Math.min(x1, shade.end ?? shade.start + 0.5));
              return (
                <rect key={i} x={start} y={MARGIN.top} width={Math.max(2, end - start)} height={plotH} fill="var(--danger)" opacity={0.1} />
              );
            })}
            {/* grid and y axis */}
            {yTicks.map((tick) => (
              <g key={`y${tick}`}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(tick)} y2={y(tick)} stroke="var(--border)" />
                <text x={MARGIN.left - 6} y={y(tick) + 3.5} textAnchor="end" fontSize={11} fill="var(--ink-secondary)">
                  {formatY(tick)}
                </text>
              </g>
            ))}
            <text x={MARGIN.left} y={12} fontSize={11} fontWeight={600} fill="var(--ink-secondary)">
              {yLabel}
            </text>
            {/* x axis */}
            <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH} stroke="var(--ink-secondary)" opacity={0.4} />
            {ticks.map((tick) => (
              <text
                key={`x${tick}`}
                x={x(tick)}
                y={MARGIN.top + plotH + 15}
                textAnchor={tick === x0 ? "start" : "middle"}
                fontSize={11}
                fill="var(--ink-secondary)"
              >
                {formatX(tick)}
              </text>
            ))}
            <text x={MARGIN.left + plotW / 2} y={height - 4} textAnchor="middle" fontSize={11} fill="var(--ink-secondary)">
              {xLabel}
            </text>
            {/* lines */}
            {series.map((s) => (
              <g key={s.id}>
                {runs(s.points).map((run, i) =>
                  run.length === 1 ? (
                    <circle key={i} cx={x(run[0].t)} cy={y(run[0].v)} r={2.5} fill={s.color} />
                  ) : (
                    <path
                      key={i}
                      d={run.map((p, k) => `${k ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2}
                      strokeDasharray={s.dashed ? "5 4" : undefined}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ),
                )}
                {showPoints
                  ? s.points.map((p, i) =>
                      p.v === null ? null : <circle key={`pt${i}`} cx={x(p.t)} cy={y(p.v)} r={3.5} fill={s.color} stroke="white" strokeWidth={1.5} />,
                    )
                  : null}
              </g>
            ))}
            {/* playhead */}
            {playhead !== null && playhead !== undefined && playhead >= x0 && playhead <= x1 ? (
              <g pointerEvents="none">
                <line x1={x(playhead)} x2={x(playhead)} y1={MARGIN.top - 4} y2={MARGIN.top + plotH} stroke="var(--danger)" strokeWidth={1.5} />
                <path d={`M${x(playhead) - 4},${MARGIN.top - 8}L${x(playhead) + 4},${MARGIN.top - 8}L${x(playhead)},${MARGIN.top - 2}Z`} fill="var(--danger)" />
              </g>
            ) : null}
          </svg>
        ) : null}
      </div>
      {hasData ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
          {legend.map((item) => (
            <li key={item.key} className="inline-flex items-center gap-1.5">
              <svg width="18" height="8" aria-hidden>
                <line x1="1" x2="17" y1="4" y2="4" stroke={item.color} strokeWidth={2.5} strokeDasharray={item.dashed ? "4 3" : undefined} />
              </svg>
              {item.label}
            </li>
          ))}
          {bands.map((band) => (
            <li key={`b${band.from}`} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-3.5 rounded-sm" style={{ background: BAND_FILL[band.tone].fill, opacity: 0.35 }} aria-hidden />
              {band.label}
            </li>
          ))}
          {shades.length && shadeLabel ? (
            <li className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-3.5 rounded-sm bg-danger/25" aria-hidden />
              {shadeLabel}
            </li>
          ) : null}
          {playhead !== null && playhead !== undefined ? (
            <li className="inline-flex items-center gap-1.5">
              <span className="h-3 w-0.5 bg-danger" aria-hidden />
              Video position
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

type Run = Array<{ t: number; v: number }>;

function runs(points: ChartSeries["points"]): Run[] {
  const out: Run[] = [];
  let current: Run = [];
  for (const p of points) {
    if (p.v === null || Number.isNaN(p.v)) {
      if (current.length) out.push(current);
      current = [];
    } else {
      current.push({ t: p.t, v: p.v });
    }
  }
  if (current.length) out.push(current);
  return out;
}

function uniqueLegend(series: ChartSeries[]) {
  const seen = new Map<string, { key: string; label: string; color: string; dashed: boolean }>();
  for (const s of series) {
    const key = `${s.label}|${s.color}|${s.dashed ? 1 : 0}`;
    if (!seen.has(key)) seen.set(key, { key, label: s.label, color: s.color, dashed: Boolean(s.dashed) });
  }
  return [...seen.values()];
}
