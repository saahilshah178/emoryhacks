"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenCheck, Search, Video, type LucideIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Avatar, Spinner, StateBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { plural, relativeTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { aiAssessment, caregiverStatus, categoryLabel, reviewState } from "@/lib/status";
import type { AttemptSummary, CaregiverRow, SkillSummary } from "@/lib/types";
import { searchablePages } from "@/nurse/nav";

/** How many results one group lists before it says how many more there are. */
const GROUP_LIMIT = 5;

type Option = {
  key: string;
  href: string;
  title: string;
  detail: string;
  leading: ReactNode;
  trailing?: ReactNode;
};

type Group = { id: string; heading: string; options: Option[]; more: number };

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-teal-soft text-teal">
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

/**
 * How well something matches what was typed, lower is better, or null when it does not.
 * Every word typed has to appear somewhere in the title or the other text, so
 * "sarah transfer" finds Sarah's transfer submissions.
 */
function rank(words: string[], title: string, ...other: Array<string | null | undefined>) {
  const name = title.toLowerCase();
  const text = [name, ...other.map((value) => (value ?? "").toLowerCase())].join(" ");
  if (!words.every((word) => text.includes(word))) return null;
  if (name.startsWith(words.join(" "))) return 0;
  const parts = name.split(/[^a-z0-9]+/);
  if (words.every((word) => parts.some((part) => part.startsWith(word)))) return 1;
  if (words.every((word) => name.includes(word))) return 2;
  return 3;
}

/** The best matches first; equal matches keep the order they came in. */
function matches<T>(items: T[], words: string[], score: (item: T) => number | null) {
  return items
    .map((item) => ({ item, score: score(item) }))
    .filter((entry): entry is { item: T; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.item);
}

function group(id: string, heading: string, options: Option[]): Group | null {
  if (options.length === 0) return null;
  return { id, heading, options: options.slice(0, GROUP_LIMIT), more: Math.max(0, options.length - GROUP_LIMIT) };
}

function caregiverOption(person: CaregiverRow): Option {
  return {
    key: `caregiver-${person.id}`,
    href: `/dashboard/caregivers/${person.id}`,
    title: person.name,
    detail: [person.title || "Caregiver", person.location].filter(Boolean).join(" · "),
    leading: <Avatar name={person.name} />,
    trailing:
      person.status === "active" ? (
        <span className="whitespace-nowrap text-xs text-ink-muted">
          {person.skills_verified}/{person.skills_total} verified
        </span>
      ) : (
        <StateBadge entry={caregiverStatus[person.status]} />
      ),
  };
}

function skillOption(skill: SkillSummary): Option {
  return {
    key: `skill-${skill.id}`,
    href: `/dashboard/skills/${skill.id}`,
    title: skill.name,
    detail: [categoryLabel[skill.category] ?? skill.category, plural(skill.step_count, "step")].join(" · "),
    leading: <IconTile icon={BookOpenCheck} />,
  };
}

function attemptOption(attempt: AttemptSummary): Option {
  return {
    key: `attempt-${attempt.id}`,
    href: `/dashboard/reviews/${attempt.id}`,
    title: attempt.skill_name,
    // The list holds what caregivers sent, so it is timed by when it was sent.
    detail: `${attempt.caregiver_name} · sent ${relativeTime(attempt.submitted_at ?? attempt.created_at).replace(
      /^(Just now|Yesterday)$/,
      (m) => m.toLowerCase(),
    )}${attempt.submit_kind === "forced" ? " · sent anyway" : ""}`,
    leading: <IconTile icon={Video} />,
    trailing: <StateBadge entry={reviewState[attempt.review_state]} />,
  };
}

/**
 * The search box in the top bar. It does not change the page underneath: it lists the
 * pages, caregivers, skills and submissions that match, and choosing one opens it.
 */
export function GlobalSearch({ onOpen, className }: { onOpen?: () => void; className?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // The lists are fetched the first time the box is used, not on every page.
  const [armed, setArmed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const caregivers = useApi<CaregiverRow[]>(armed ? "/caregivers" : null);
  const skills = useApi<SkillSummary[]>(armed ? "/skills" : null);
  const attempts = useApi<AttemptSummary[]>(armed ? "/attempts" : null);

  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const typed = words.length > 0;

  const groups = useMemo<Group[]>(() => {
    const pages = (typed
      ? matches(searchablePages, words, (page) => rank(words, page.label, page.keywords))
      : searchablePages
    ).map<Option>((page) => ({
      key: `page-${page.href}`,
      href: page.href,
      title: page.label,
      detail: "Page",
      leading: <IconTile icon={page.icon} />,
    }));
    // With nothing typed, every page is offered.
    if (!typed) return [{ id: "pages", heading: "Go to", options: pages, more: 0 }];

    const people = matches(caregivers.data ?? [], words, (person) =>
      rank(words, person.name, person.title, person.location, person.email, caregiverStatus[person.status]?.label),
    );
    const library = matches(skills.data ?? [], words, (skill) =>
      rank(words, skill.name, categoryLabel[skill.category], skill.category, skill.summary),
    );
    // Submissions waiting for a nurse come before decided ones; within that, newest first.
    const submissions = matches(attempts.data ?? [], words, (attempt) => {
      const score = rank(
        words,
        `${attempt.caregiver_name} ${attempt.skill_name}`,
        attempt.caregiver_title,
        attempt.review_state,
        reviewState[attempt.review_state].label,
        attempt.ai_assessment ? aiAssessment[attempt.ai_assessment].label : null,
      );
      if (score === null) return null;
      return score * 2 + (attempt.review_state === "pending" ? 0 : 1);
    });

    return [
      group("pages", "Pages", pages),
      group("caregivers", "Caregivers", people.map(caregiverOption)),
      group("skills", "Skills", library.map(skillOption)),
      group("submissions", "Submissions", submissions.map(attemptOption)),
    ].filter((item): item is Group => item !== null);
  }, [typed, words, caregivers.data, skills.data, attempts.data]);

  const options = useMemo(() => groups.flatMap((item) => item.options), [groups]);
  // Where each group's first option sits in that flat list, which the arrow keys walk through.
  const starts = groups.map((_, at) => groups.slice(0, at).reduce((sum, item) => sum + item.options.length, 0));
  const activeIndex = Math.min(active, options.length - 1);
  const loading = typed && (caregivers.loading || skills.loading || attempts.loading);
  const errors = [...new Set([caregivers.error, skills.error, attempts.error].filter((error): error is string => Boolean(error)))];

  // Arrow keys can move the highlight past the edge of the list's scroll area.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listId]);

  function reload() {
    caregivers.reload();
    skills.reload();
    attempts.reload();
  }

  function show() {
    if (open) return;
    setOpen(true);
    onOpen?.();
    // Each time the box is opened it looks again, so a new submission can be found.
    if (armed) reload();
    else setArmed(true);
  }

  function reset() {
    setQuery("");
    setActive(0);
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      const chosen = open ? options[activeIndex] : undefined;
      if (!chosen) return;
      event.preventDefault();
      router.push(chosen.href);
      reset();
    } else if (event.key === "Escape") {
      if (open) setOpen(false);
      else setQuery("");
    }
  }

  return (
    <div
      className={cn("relative", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search for a caregiver, skill, submission or page"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          show();
        }}
        onFocus={show}
        onClick={show}
        onKeyDown={onKeyDown}
        placeholder="Search caregivers, skills, or submissions"
        className="h-10 w-full rounded-full border border-border bg-secondary pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-secondary focus:border-teal focus:bg-white focus:ring-2 focus:ring-teal/20"
      />

      {open ? (
        <div
          // Keeps the cursor in the box while a result is clicked, so the list does not close first.
          onMouseDown={(event) => event.preventDefault()}
          className="absolute left-0 top-full z-40 mt-2 w-[28rem] min-w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-[12px] border border-border bg-white shadow-[var(--shadow-card)]"
        >
          <div id={listId} role="listbox" aria-label="Search results" className="max-h-[min(70vh,30rem)] overflow-y-auto p-1.5">
            {groups.map((item, at) => (
              <div key={item.id} role="group" aria-labelledby={`${listId}-${item.id}`} className="pb-1.5 last:pb-0">
                <p id={`${listId}-${item.id}`} className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-muted">
                  {item.heading}
                </p>
                {item.options.map((option, offset) => {
                  const position = starts[at] + offset;
                  const highlighted = position === activeIndex;
                  return (
                    <Link
                      key={option.key}
                      id={`${listId}-${position}`}
                      role="option"
                      aria-selected={highlighted}
                      tabIndex={-1}
                      href={option.href}
                      onClick={reset}
                      onMouseMove={() => setActive(position)}
                      className={cn(
                        "flex items-center gap-3 rounded-[10px] px-2.5 py-2 outline-none",
                        highlighted && "bg-secondary",
                      )}
                    >
                      {option.leading}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{option.title}</span>
                        <span className="block truncate text-xs text-ink-secondary">{option.detail}</span>
                      </span>
                      {option.trailing}
                    </Link>
                  );
                })}
                {item.more > 0 ? (
                  <p className="px-2.5 pt-1 text-xs text-ink-muted">
                    {item.more} more not shown. Keep typing to narrow it down.
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="border-t border-border px-4 py-2.5 text-xs text-ink-secondary empty:hidden">
            {loading ? (
              <p className="flex items-center gap-2">
                <Spinner className="h-3.5 w-3.5" label="Searching" />
                Looking through caregivers, skills and submissions…
              </p>
            ) : !typed ? (
              <p>Type a name to find a caregiver, a skill or a submission.</p>
            ) : options.length === 0 && errors.length === 0 ? (
              <p>
                Nothing matches “{query.trim()}”. Try a caregiver&apos;s name, a skill, or a status such as approved.
              </p>
            ) : null}
            {errors.length > 0 ? (
              <p role="alert" className="text-danger">
                Some results could not be loaded. {errors.join(" ")}{" "}
                <button type="button" onClick={reload} className="font-medium underline">
                  Try again
                </button>
              </p>
            ) : null}
          </div>
          <p className="sr-only" role="status">
            {loading ? "Searching" : plural(options.length, "result")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
