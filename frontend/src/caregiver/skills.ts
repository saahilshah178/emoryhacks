// Where each skill leads and which one to suggest next. Pure helpers shared by the portal pages.
import type { MySkill, SkillState } from "@/lib/types";

export function practiceHref(skillId: string) {
  return `/portal/skills/${skillId}`;
}

export function resultsHref(skillId: string, attemptId?: string | null) {
  return `/portal/skills/${skillId}/results${attemptId ? `?attempt=${attemptId}` : ""}`;
}

/** True when the nurse set a limit and every attempt in it is used. */
export function outOfAttempts(skill: Pick<MySkill, "attempts_left">) {
  return skill.attempts_left === 0;
}

/**
 * A skill card's link: a recording still being checked (its progress) first, then one that is
 * ready to send, then the result behind the skill's state once there is one, otherwise the
 * practice flow.
 */
export function skillHref(skill: MySkill) {
  if (skill.checking_attempt_id) return resultsHref(skill.id, skill.checking_attempt_id);
  if (skill.ready_attempt_id) return resultsHref(skill.id, skill.ready_attempt_id);
  return skill.state === "not_started" || !skill.attempt_id
    ? practiceHref(skill.id)
    : resultsHref(skill.id, skill.attempt_id);
}

/**
 * What the caregiver should do next on a skill they are working on: follow a recording being
 * checked, send one that is ready, otherwise record (or, with no attempts left, read their result).
 */
export function nextStep(skill: MySkill): { href: string; label: string } {
  if (skill.checking_attempt_id) {
    return { href: resultsHref(skill.id, skill.checking_attempt_id), label: `Follow your ${skill.name} check` };
  }
  if (skill.ready_attempt_id) {
    return { href: resultsHref(skill.id, skill.ready_attempt_id), label: `Send ${skill.name} to your nurse` };
  }
  if (outOfAttempts(skill) && skill.attempt_id) {
    return { href: resultsHref(skill.id, skill.attempt_id), label: `See your ${skill.name} result` };
  }
  return { href: practiceHref(skill.id), label: `Continue with ${skill.name}` };
}

// What needs the caregiver first: a nurse's request, then a skill they are partway through,
// then anything not tried, then what is with a nurse or done.
const stateOrder: SkillState[] = ["needs_practice", "practicing", "not_started", "in_review", "verified"];

/** Sort key: a recording ready to send comes before everything, then the states in order. */
export function skillPriority(skill: MySkill) {
  return skill.ready_attempt_id ? -1 : stateOrder.indexOf(skill.state);
}

/**
 * The skill to work on next: a recording that is ready to send, then one a nurse asked to
 * practise again, then one partway through, then one not started. Null when every skill is
 * verified or waiting for a nurse.
 */
export function recommendedSkill(skills: MySkill[]): MySkill | null {
  return (
    skills.find((skill) => skill.ready_attempt_id) ??
    skills.find((skill) => skill.state === "needs_practice") ??
    skills.find((skill) => skill.state === "practicing") ??
    skills.find((skill) => skill.state === "not_started") ??
    null
  );
}
