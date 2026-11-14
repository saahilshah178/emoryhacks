import { Badge } from "@/components/ui";
import { personRole } from "@/lib/status";
import type { Person } from "@/lib/types";

/** Who the AI identified in the recording. */
export function PeoplePanel({ people }: { people: Person[] }) {
  if (!people.length) {
    return (
      <p className="rounded-[12px] border border-dashed border-border bg-white px-4 py-3 text-sm text-ink-secondary">
        The AI did not name the people in this recording.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-[12px] border border-border bg-white">
      {people.map((person) => (
        <li key={person.label} className="flex flex-wrap items-start gap-3 px-4 py-3">
          <span className="w-8 shrink-0 text-sm font-semibold text-ink">{person.label}</span>
          <Badge tone={person.role === "caregiver" ? "teal" : person.role === "patient" ? "info" : "neutral"}>
            {personRole[person.role]}
          </Badge>
          <span className="min-w-0 flex-1 basis-48 text-sm text-ink-secondary">{person.description}</span>
        </li>
      ))}
    </ul>
  );
}
