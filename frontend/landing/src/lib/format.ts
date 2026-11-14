// One set of formatters for every screen.

/** 75.4 -> "1:15". Missing values read as "--:--". */
export function formatClock(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return "--:--";
  const whole = Math.max(0, Math.floor(Number(seconds)));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** True when a stretch of video has a real end after its start. */
export function hasSpan(start: number | null | undefined, end: number | null | undefined) {
  return start !== null && start !== undefined && end !== null && end !== undefined && Number(end) > Number(start);
}

/** "0:05–0:08" */
export function formatRange(start: number, end: number) {
  return `${formatClock(start)}–${formatClock(end)}`;
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  // A date without a time ("2026-09-08") is a calendar day, not midnight UTC.
  const value = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function relativeTime(iso: string | null | undefined) {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export function matchesQuery(query: string, ...values: Array<string | number | null | undefined>) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(q));
}

export function percent(fraction: number | null | undefined, digits = 0) {
  if (fraction === null || fraction === undefined) return "–";
  return `${(fraction * 100).toFixed(digits)}%`;
}
