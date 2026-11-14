import { cn } from "@/lib/cn";

/*
 * The decoration behind every page: soft green glows that drift slowly, and two vines
 * that draw themselves in when the page opens (one up the left edge, one across the
 * bottom). It sits behind all text and cards, never in front, and is ignored by mouse,
 * keyboard and screen readers. The parent must be `relative isolate` so the layer stays
 * above the parent's own background but below its content. Motion stops for anyone who
 * asks their device to reduce it (see globals.css).
 */

// One family of greens, from the brand teal to a pale sage, so the vines and glows match.
const LEAVES = ["#176C71", "#3f8f87", "#6fae9f", "#9fcdb9", "#b9d6a8"];
const STEM = "#2f6f68";

const GLOWS = [
  { style: { left: "-140px", top: "-60px", width: 520, height: 520 }, color: "rgba(159,205,185,0.38)", delay: "0s" },
  { style: { right: "-140px", top: "28%", width: 480, height: 480 }, color: "rgba(185,214,168,0.34)", delay: "-7s" },
  { style: { left: "30%", bottom: "-200px", width: 460, height: 460 }, color: "rgba(111,174,159,0.22)", delay: "-14s" },
];

const FALLING = [
  { left: "14%", delay: "2s", color: "#6fae9f" },
  { left: "52%", delay: "10s", color: "#9fcdb9" },
  { left: "84%", delay: "18s", color: "#3f8f87" },
];

function path(points: [number, number][]) {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

function Leaf({ at, angle, color, delay }: { at: [number, number]; angle: number; color: string; delay: number }) {
  return (
    <g transform={`translate(${at[0]} ${at[1]}) rotate(${angle})`}>
      {/* Each leaf flutters on its own beat, so they don't all move together. */}
      <g className="lively-flutter" style={{ animationDelay: `${-delay * 3.7}s`, animationDuration: `${3.2 + (delay * 10) % 2}s` }}>
        <path
          d="M0 0 C 8 -11, 24 -13, 32 0 C 24 13, 8 11, 0 0Z"
          fill={color}
          className="lively-leaf"
          style={{ animationDelay: `${delay}s` }}
        />
      </g>
    </g>
  );
}

/** Climbs the left edge of the page. */
const sideLine = (y: number): [number, number] => [44 + Math.sin(y / 70) * 18, y];
const SIDE_H = 900;
const sidePath = path(Array.from({ length: 81 }, (_, i) => sideLine((SIDE_H * i) / 80)));
// The leaves start below the page titles, so none sits behind a heading.
const sideLeaves = Array.from({ length: 9 }, (_, i) => ({ at: sideLine(160 + i * 86), up: i % 2 === 0 }));

/** Winds across the bottom of the page. */
const BOTTOM_W = 1440;
const bottomLine = (x: number): [number, number] => [x, 120 + Math.sin(x / 170) * 50];
const bottomPath = path(Array.from({ length: 81 }, (_, i) => bottomLine((BOTTOM_W * i) / 80)));
const bottomLeaves = Array.from({ length: 16 }, (_, i) => ({ at: bottomLine(40 + i * 90), up: i % 2 === 0 }));

/**
 * belowHeader: the page has a 4rem sticky top bar above this area at every width (the nurse
 * dashboard). belowMobileHeader: only below the `lg` width (the caregiver portal). Either way
 * the layer fills the space under the bar.
 */
export function LivelyBackground({
  className,
  belowHeader = false,
  belowMobileHeader = false,
}: {
  className?: string;
  belowHeader?: boolean;
  belowMobileHeader?: boolean;
}) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10 overflow-clip rounded-[inherit]", className)}>
      {/* Stays in view while the page scrolls. */}
      <div
        className={cn(
          "sticky w-full overflow-hidden",
          belowHeader
            ? "top-16 h-[calc(100dvh-4rem)]"
            : belowMobileHeader
              ? "top-16 h-[calc(100dvh-4rem)] lg:top-0 lg:h-dvh"
              : "top-0 h-dvh",
        )}
      >
        {GLOWS.map((glow, i) => (
          <div
            key={i}
            className="lively-glow absolute rounded-full"
            style={{ ...glow.style, background: glow.color, filter: "blur(70px)", animationDelay: glow.delay }}
          />
        ))}

        <svg
          viewBox={`0 0 90 ${SIDE_H}`}
          preserveAspectRatio="xMinYMin slice"
          className="absolute left-0 top-0 hidden h-full w-[90px] md:block"
        >
          <g className="lively-sway-side">
            <path d={sidePath} fill="none" stroke={STEM} strokeWidth="2.4" pathLength={1} className="lively-stem" />
            {sideLeaves.map((leaf, i) => (
              <Leaf key={i} at={leaf.at} angle={leaf.up ? -25 : 205} color={LEAVES[(i + 2) % LEAVES.length]} delay={0.3 + i * 0.14} />
            ))}
          </g>
        </svg>

        <svg
          viewBox={`0 0 ${BOTTOM_W} 200`}
          preserveAspectRatio="xMidYMax slice"
          className="absolute inset-x-0 bottom-0 h-[200px] w-full"
        >
          <g className="lively-sway-bottom">
            <path d={bottomPath} fill="none" stroke={STEM} strokeWidth="2.4" pathLength={1} className="lively-stem" />
            {bottomLeaves.map((leaf, i) => (
              <Leaf key={i} at={leaf.at} angle={leaf.up ? -60 : 50} color={LEAVES[i % LEAVES.length]} delay={0.5 + i * 0.12} />
            ))}
          </g>
        </svg>

        {/* Now and then a leaf drifts down the page, roughly one every eight seconds. */}
        {FALLING.map((leaf, i) => (
          <span key={i} className="lively-fall absolute -top-10" style={{ left: leaf.left, animationDelay: leaf.delay }}>
            <svg viewBox="-16 -16 32 32" width="26" height="26" className="lively-drift block" style={{ animationDelay: leaf.delay }}>
              <path d="M-14 0 C -7 -10, 7 -10, 14 0 C 7 10, -7 10, -14 0Z" fill={leaf.color} />
              <path d="M-14 0 H 11" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1" />
            </svg>
          </span>
        ))}
      </div>
    </div>
  );
}
