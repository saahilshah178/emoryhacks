"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { formatClock, formatRange, hasSpan } from "@/lib/format";
import { toneSolid, type Tone } from "@/lib/status";

/** One step as a stretch of one video. A chapter without a span is listed, never placed. */
export type Chapter = {
  id: string;
  /** The step's number in the skill, as the viewer knows it ("Step 3"). */
  number: number;
  title: string;
  /** Seconds into this video. Null (or an end not after the start) means it has no place in it. */
  start: number | null | undefined;
  end: number | null | undefined;
  /** Colours the segment, e.g. by a graded status. Without one, segments are teal. */
  tone?: Tone;
  /** Drawn lighter, e.g. a stretch the grader cited rather than one the timeline found. */
  faded?: boolean;
  /** Added to the segment's spoken label and tooltip, e.g. "Passed". */
  hint?: string;
  /** The step was not needed in this video: never placed, and not listed as missing. */
  notNeeded?: boolean;
};

/** A point above the bar, e.g. a safety flag. */
export type ChapterMarker = {
  id: string;
  at: number;
  label: string;
  tone: "danger" | "warning" | "neutral";
  onClick?: () => void;
};

type Placed = Chapter & { start: number; end: number };

/** The chapters that have a place in the video, in video order. */
export function placedChapters(chapters: Chapter[]): Placed[] {
  return chapters
    .filter((c): c is Placed => hasSpan(c.start, c.end))
    .map((c) => ({ ...c, start: Number(c.start), end: Number(c.end) }))
    .sort((a, b) => a.start - b.start || a.number - b.number);
}

/** The chapter under the playhead: the latest-starting one when stretches overlap. */
export function chapterAt<T extends { start: number; end: number }>(placed: T[], seconds: number): T | null {
  let found: T | null = null;
  for (const c of placed) if (c.start <= seconds && seconds < c.end) found = c;
  return found;
}

/**
 * Which chapter is current: the one last pressed while the playhead is still in (or right
 * next to) it, so overlapping stretches don't steal the highlight; otherwise the one under
 * the playhead. Use this to highlight the same step in a list beside the bar.
 */
export function currentChapterId(placed: Placed[], time: number, picked: string | null) {
  const chosen = picked ? placed.find((c) => c.id === picked) : undefined;
  if (chosen && time >= chosen.start - 0.5 && time < chosen.end + 0.3) return chosen.id;
  return chapterAt(placed, time)?.id ?? null;
}

/**
 * The current step for a bar and a list that must agree on it.
 *
 *   const current = useCurrentChapter(chapters, player.time, player.play);
 *   <StepChapters chapters={chapters} activeId={current.id} onSelect={current.select} ... />
 *   <li data-step-id={step.step_id} aria-current={current.id === step.step_id ? "step" : undefined}>
 *
 * select(chapter) remembers the choice and plays its stretch (when it has one and play is given).
 */
export function useCurrentChapter(
  chapters: Chapter[],
  time: number | null,
  play?: (start: number, end?: number | null) => void,
) {
  const [picked, setPicked] = useState<string | null>(null);
  const id = time === null && !picked ? null : currentChapterId(placedChapters(chapters), time ?? 0, picked);
  const select = useCallback(
    (chapter: Chapter) => {
      setPicked(chapter.id);
      if (play && hasSpan(chapter.start, chapter.end)) play(Number(chapter.start), Number(chapter.end));
    },
    [play],
  );
  return { id, select };
}

const MARKER_FILL ={ danger: "fill-danger", warning: "fill-warning", neutral: "fill-ink-secondary" } as const;
/** Below this many pixels a segment drops its number; the line under the bar names it. */
const NUMBER_MIN_PX = 18;
const MIN_SEGMENT_PX = 6;

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * A video's steps as chapters: one segment per timed step, placed and sized by its stretch
 * within the video, the segment under the playhead highlighted, a line naming the current
 * step, and Previous / Next step buttons. Pressing a segment plays that step and stops at
 * its end. Steps without a time are left off the bar and listed under it (missingText), and
 * steps that were not needed are listed on a line of their own (notNeededText);
 * when no step has a time, one sentence (emptyText) stands in for the bar.
 *
 *   const player = useVideoSegments();
 *   <VideoFrame video={skill.video} videoRef={player.ref} />
 *   <StepChapters chapters={...} duration={skill.video.duration_s} time={player.time} onPlay={player.play} />
 *
 * Pass onSelect instead of (or as well as) onPlay to decide yourself what pressing a step
 * does, and activeId to say which step is current (e.g. to keep a list and the bar in step).
 * With neither onPlay nor onSelect the bar only shows where the steps are.
 */
export function StepChapters({
  chapters,
  duration,
  time,
  onPlay,
  onSelect,
  activeId,
  label = "Steps in this video",
  emptyText = "The steps in this video have no times yet.",
  missingText,
  notNeededText,
  markers,
  footer,
  className,
}: {
  /** Every step, in the skill's order. Untimed ones are listed, not placed. */
  chapters: Chapter[];
  /** The video's length in seconds. */
  duration: number | null | undefined;
  /** The playhead, in seconds (useVideoSegments().time). Null when there is nothing to follow. */
  time: number | null;
  /** Plays a stretch and stops at its end (useVideoSegments().play). */
  onPlay?: (start: number, end?: number | null) => void;
  /** Called when a step is chosen from the bar or Previous / Next. Replaces onPlay's call when given. */
  onSelect?: (chapter: Chapter) => void;
  /** The current step, when the page decides it. Leave undefined to follow the playhead. */
  activeId?: string | null;
  /** Names the bar for screen readers, e.g. "Steps in the demonstration". */
  label?: string;
  /** Said instead of the bar when no step has a time. */
  emptyText?: string;
  /** Introduces the steps without a time, e.g. "Not seen in your recording". Omit to leave them unlisted. */
  missingText?: string;
  /** Introduces the steps that were not needed, e.g. "Not needed this time". Omit to leave them unlisted. */
  notNeededText?: string;
  markers?: ChapterMarker[];
  /** Extra lines under the bar, e.g. a legend. */
  footer?: ReactNode;
  className?: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [barRef, barWidth] = useWidth<HTMLDivElement>();
  const placed = placedChapters(chapters);
  const missing = chapters.filter((c) => !c.notNeeded && !hasSpan(c.start, c.end));
  const notNeeded = chapters.filter((c) => c.notNeeded);
  const interactive = Boolean(onPlay || onSelect);

  const choose = useCallback(
    (chapter: Placed) => {
      setPicked(chapter.id);
      if (onSelect) onSelect(chapter);
      else onPlay?.(chapter.start, chapter.end);
    },
    [onPlay, onSelect],
  );

  if (placed.length === 0) {
    return <p className={cn("text-sm text-ink-secondary", className)}>{emptyText}</p>;
  }

  const t = time ?? 0;
  const total = Math.max(Number(duration) || 0, ...placed.map((c) => c.end), 1);
  const pct = (s: number) => (Math.min(total, Math.max(0, s)) / total) * 100;
  const currentId =
    activeId !== undefined ? activeId : time === null && !picked ? null : currentChapterId(placed, t, picked);
  const index = placed.findIndex((c) => c.id === currentId);
  const current = index === -1 ? null : placed[index];

  let previous: Placed | undefined;
  let next: Placed | undefined;
  if (current) {
    previous = placed[index - 1];
    next = placed[index + 1];
  } else if (time === null) {
    next = placed[0];
  } else {
    next = placed.find((c) => c.start > t + 0.05);
    previous = [...placed].reverse().find((c) => c.start < t - 0.05);
  }

  // Greedy lanes, so overlapping stretches sit on separate rows instead of hiding each other.
  const laneEnds: number[] = [];
  const segments = placed.map((chapter) => {
    let lane = laneEnds.findIndex((end) => end <= chapter.start + 0.05);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = chapter.end;
    return { chapter, lane };
  });
  const lanes = Math.max(1, laneEnds.length);
  const laneHeight = lanes === 1 ? 28 : 22;

  const count = chapters.length;
  const name = (c: Chapter) => `Step ${c.number} of ${count}`;
  const spoken = (c: Placed) =>
    `${name(c)}: ${c.title}, ${formatClock(c.start)} to ${formatClock(c.end)}${c.hint ? `, ${c.hint}` : ""}`;

  let lead: string | null = null;
  let shown: Placed | undefined = current ?? undefined;
  if (!shown) {
    shown = next ?? previous;
    lead = next ? "Up next" : "Last step";
  }

  return (
    <div className={cn("@container min-w-0", className)}>
      <div role="group" aria-label={label}>
        {markers?.length ? (
          <div className="relative h-5">
            {markers.map((marker) => {
              const shape = (
                <svg viewBox="0 0 10 9" className="h-3 w-3" aria-hidden>
                  <path d="M5 0L10 9H0Z" className={MARKER_FILL[marker.tone]} />
                </svg>
              );
              const style = { left: `${pct(marker.at)}%` };
              return marker.onClick ? (
                <button
                  key={marker.id}
                  type="button"
                  title={marker.label}
                  aria-label={`Play ${marker.label}`}
                  onClick={marker.onClick}
                  className="absolute top-1 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-sm hover:bg-secondary"
                  style={style}
                >
                  {shape}
                </button>
              ) : (
                <span
                  key={marker.id}
                  title={marker.label}
                  className="absolute top-1 flex h-4 w-4 -translate-x-1/2 items-center justify-center"
                  style={style}
                >
                  {shape}
                  <span className="sr-only">{marker.label}</span>
                </span>
              );
            })}
          </div>
        ) : null}

        <div ref={barRef} className="relative rounded-[8px] bg-secondary" style={{ height: lanes * laneHeight + 4 }}>
          {segments.map(({ chapter, lane }) => {
            const on = chapter.id === currentId;
            const px = ((chapter.end - chapter.start) / total) * barWidth;
            const showNumber = barWidth === 0 || px - 2 >= NUMBER_MIN_PX;
            const toned = Boolean(chapter.tone);
            const classes = cn(
              "absolute flex items-center justify-center overflow-hidden rounded-[5px] text-[11px] font-semibold tabular-nums transition-[background-color,box-shadow]",
              toned
                ? cn(toneSolid[chapter.tone as Tone], "text-white", chapter.faded && "opacity-70")
                : on
                  ? "bg-teal text-white"
                  : cn("bg-teal/30 text-teal", interactive && "hover:bg-teal/50", chapter.faded && "bg-teal/15"),
              on ? "z-10 ring-2 ring-navy ring-offset-1 ring-offset-secondary" : toned && interactive && "hover:ring-2 hover:ring-navy/40",
            );
            const style = {
              left: `calc(${pct(chapter.start)}% + 1px)`,
              width: `max(${MIN_SEGMENT_PX}px, calc(${pct(chapter.end) - pct(chapter.start)}% - 2px))`,
              top: 2 + lane * laneHeight + 2,
              height: laneHeight - 4,
            };
            const tip = `${name(chapter)}: ${chapter.title} (${formatRange(chapter.start, chapter.end)})${
              chapter.hint ? ` · ${chapter.hint}` : ""
            }`;
            return interactive ? (
              <button
                key={chapter.id}
                type="button"
                onClick={() => choose(chapter)}
                aria-label={`Play ${spoken(chapter)}`}
                aria-current={on ? "step" : undefined}
                title={tip}
                className={classes}
                style={style}
              >
                {showNumber ? chapter.number : null}
              </button>
            ) : (
              <span key={chapter.id} title={tip} className={classes} style={style}>
                {showNumber ? <span aria-hidden>{chapter.number}</span> : null}
                <span className="sr-only">{spoken(chapter)}</span>
              </span>
            );
          })}
          {time !== null ? (
            <span
              className="pointer-events-none absolute -bottom-1 -top-1 z-20 w-0.5 -translate-x-1/2 rounded-full bg-navy"
              style={{ left: `${pct(t)}%` }}
              aria-hidden
            />
          ) : null}
        </div>

        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-secondary" aria-hidden>
          <span>{formatClock(0)}</span>
          <span>{formatClock(total)}</span>
        </div>
      </div>

      {/* Side by side only when the bar is wide enough; a narrow column stacks them. */}
      <div className="mt-2 flex flex-col gap-2 @lg:flex-row @lg:items-center @lg:gap-3">
        <p className="min-w-0 flex-1 text-sm text-ink" aria-live="polite">
          {shown ? (
            <>
              {lead ? <span className="text-ink-secondary">{lead}: </span> : null}
              <span className="font-semibold text-navy">{name(shown)}</span>
              <span className="text-ink-secondary"> · </span>
              {shown.title}
              <span className="text-ink-secondary"> · </span>
              <span className="whitespace-nowrap tabular-nums text-ink-secondary">
                {formatRange(shown.start, shown.end)}
              </span>
            </>
          ) : null}
        </p>
        {interactive ? (
          <div className="grid shrink-0 grid-cols-2 gap-2">
            <NavButton direction="previous" target={previous} onClick={choose} />
            <NavButton direction="next" target={next} onClick={choose} />
          </div>
        ) : null}
      </div>

      {missingText && missing.length ? (
        <p className="mt-2 text-xs text-ink-secondary">
          <span className="font-medium text-ink">{missingText}:</span>{" "}
          {missing.map((c) => `${c.number}. ${c.title}`).join(", ")}
        </p>
      ) : null}
      {notNeededText && notNeeded.length ? (
        <p className="mt-2 text-xs text-ink-secondary">
          <span className="font-medium text-ink">{notNeededText}:</span>{" "}
          {notNeeded.map((c) => `${c.number}. ${c.title}`).join(", ")}
        </p>
      ) : null}
      {footer}
    </div>
  );
}

function NavButton({
  direction,
  target,
  onClick,
}: {
  direction: "previous" | "next";
  target: Placed | undefined;
  onClick: (chapter: Placed) => void;
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const word = direction === "previous" ? "Previous step" : "Next step";
  return (
    <button
      type="button"
      disabled={!target}
      onClick={() => target && onClick(target)}
      aria-label={target ? `${word}: step ${target.number}, ${target.title}` : word}
      title={target ? `Step ${target.number} · ${formatRange(target.start, target.end)}` : undefined}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-1 rounded-[10px] border border-border bg-white px-3 text-sm font-medium text-ink transition-colors @lg:h-9",
        "hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:border-transparent disabled:bg-secondary disabled:text-ink-muted",
      )}
    >
      {direction === "previous" ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {direction === "previous" ? "Previous" : "Next"}
      {direction === "next" ? <Icon className="h-4 w-4" aria-hidden /> : null}
    </button>
  );
}

/**
 * Keep the current step in view inside its own scrolling list. Only the list scrolls, and
 * only when it is scrollable (on a phone it usually isn't, and the page is left alone).
 * Items are found by data-step-id. Runs when the current step changes, so a viewer who
 * scrolls the list while a step plays is not pulled back.
 */
export function useRevealInList(listRef: RefObject<HTMLElement | null>, activeId: string | null) {
  useEffect(() => {
    const list = listRef.current;
    if (!list || !activeId) return;
    if (list.scrollHeight <= list.clientHeight + 1) return;
    const overflow = getComputedStyle(list).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") return;
    const item = list.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(activeId)}"]`);
    if (!item) return;
    // What of the list can be seen: the list's box, cut by the window when the page has it
    // partly scrolled away (or under the sticky header the page's scroll-padding allows for).
    // The step is brought to the top of that.
    const header = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const listBox = list.getBoundingClientRect();
    let top = Math.max(listBox.top, header);
    const bottom = Math.min(listBox.bottom, window.innerHeight);
    if (bottom - top < 48) top = listBox.top;
    const box = item.getBoundingClientRect();
    if (box.top >= top && (box.bottom <= bottom || box.top <= top + 24)) return;
    list.scrollTo({ top: list.scrollTop + (box.top - top) - 8, behavior: "smooth" });
  }, [listRef, activeId]);
}
