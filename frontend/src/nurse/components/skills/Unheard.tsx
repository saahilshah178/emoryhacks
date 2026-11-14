// Criteria the automatic check skips because they are about something said: it grades without
// sound. The API lists them on each step of GET /skills/{id} (SkillStep.unheard).
import type { SkillStep, StepEvals } from "@/lib/types";

/** The skipped items of one list, by their place in it, with the words that made them skipped. */
export function unheardIn(step: SkillStep, field: keyof StepEvals): Map<number, string[]> {
  const items = step.evals?.[field] ?? [];
  return new Map(
    (step.unheard ?? [])
      .filter((item) => item.field === field && item.index < items.length)
      .map((item) => [item.index, item.words]),
  );
}

export function unheardCount(step: SkillStep) {
  return step.unheard?.length ?? 0;
}

const quoted = (words: string[]) => words.map((word) => `“${word}”`).join(", ");

/** The warning shown by a skipped criterion. */
export function UnheardNote({ words, text }: { words: string[]; text?: string }) {
  return (
    <span className="mt-0.5 block text-xs text-warning">
      {text ? <>“{text.trim().replace(/[.]+$/, "")}”: </> : null}
      The automatic check does not listen, so it will skip this ({quoted(words)}).
    </span>
  );
}
