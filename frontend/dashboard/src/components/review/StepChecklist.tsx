import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ChecklistItem } from "@/lib/types";

export function StepChecklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="divide-y divide-border rounded-[12px] border border-border bg-white">
      {items.map((item) => (
        <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-ink">{item.label}</p>
            <p className="mt-1 text-xs text-ink-secondary">{item.evidence}</p>
          </div>
          <StatusBadge status={item.status} />
        </li>
      ))}
    </ul>
  );
}
