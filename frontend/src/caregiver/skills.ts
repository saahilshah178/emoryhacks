// Where each skill leads and which one to suggest next. Pure helpers shared by the portal pages.
import type { MySkill } from "@/lib/types";

export function practiceHref(skillId: string) {
  return `/portal/skills/${skillId}`;
}

export function resultsHref(skillId: string, attemptId?: string | null) {
  return `/portal/skills/${skillId}/results${attemptId ? `?attempt=${attemptId}` : ""}`;
}

/** A skill card's link: its result once there is one, otherwise the practice flow. */
export function skillHref(skill: MySkill) {
  return skill.state === "not_started" || !skill.attempt_id
    ? practiceHref(skill.id)
    : resultsHref(skill.id, skill.attempt_id);
}

/**
 * The skill to work on next: one a nurse asked to practise again, then one not started.
 * Null when every skill is verified or waiting for a nurse.
 */
export function recommendedSkill(skills: MySkill[]): MySkill | null {
  return (
    skills.find((skill) => skill.state === "needs_practice") ??
    skills.find((skill) => skill.state === "not_started") ??
    null
  );
}
