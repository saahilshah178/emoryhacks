import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A pictogram for each kind of skill, used where a skill needs a picture.
 *
 * Black and white only: every line and fill takes the current text colour, which is black
 * unless the caller says otherwise. Each is drawn on a 64 x 64 grid with the same line
 * weight and round ends, so they read as one set. To add one, draw it here and give it a
 * rule in `byWords`.
 */
const drawings = {
  // A person rising from a chair
  sitToStand: (
    <>
      <path d="M10 20 V50 M10 38 H26 V50" />
      <circle cx="31" cy="13" r="4.5" fill="currentColor" stroke="none" />
      <path d="M30 21 L23 36 L36 38 L34 52 H40" />
      <path d="M29 25 L39 30" />
      <path d="M52 44 V24 M46 30 L52 24 L58 30" />
    </>
  ),
  // A bed, an arrow and a wheelchair
  wheelchairTransfer: (
    <>
      <path d="M5 28 V52 M27 46 V52" />
      <rect x="5" y="40" width="22" height="6" rx="1.5" />
      <path d="M9 36.5 H14" />
      <circle cx="48" cy="44" r="9" />
      <path d="M40 22 H43 V37 H55 L58.5 47 H61" />
      <path d="M16 30 C19 15 32 13 35 25" />
      <path d="M37.1 19.4 L35 25 L30.5 21.1" />
    </>
  ),
  // A wheelchair with a tick
  wheelchair: (
    <>
      <circle cx="26" cy="44" r="11" />
      <path d="M12 14 H17 V33 H34 L39 46 H44" />
      <circle cx="48" cy="18" r="9" />
      <path d="M43.5 18 L47 21.5 L52.5 15" />
    </>
  ),
  // A car with an arrow into it
  vehicle: (
    <>
      <path d="M6 44 V37 L14 34 L21 24 H41 L48 34 L56 36 Q58 36.5 58 39 V44" />
      <path d="M6 44 H12.5 M23.5 44 H40.5 M51.5 44 H58 M16 34 H47 M32 24 V34" />
      <circle cx="18" cy="45" r="5.5" />
      <circle cx="46" cy="45" r="5.5" />
      <path d="M32 5 V16 M27.5 11.5 L32 16 L36.5 11.5" />
    </>
  ),
  // A person on the floor under a warning sign
  fall: (
    <>
      <path d="M6 54 H58" />
      <circle cx="13" cy="46" r="4.5" fill="currentColor" stroke="none" />
      <path d="M19 47 L36 48 L46 42 L55 50" />
      <path d="M25 47 L30 39" />
      <path d="M42 8 L54 29 H30 Z" />
      <path d="M42 15.5 V22" />
      <circle cx="42" cy="25.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  // A helper holding the belt of a person walking
  gaitBelt: (
    <>
      <circle cx="44" cy="11" r="4.5" fill="currentColor" stroke="none" />
      <path d="M44 19 V38 L39 53 M44 38 L50 53" />
      <path d="M44 23 L53 27" />
      <rect x="38.5" y="28" width="11" height="5" rx="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="13" r="4.5" fill="currentColor" stroke="none" />
      <path d="M18 21 V39 L13 53 M18 39 L23 53" />
      <path d="M18 25 L37 30.5" />
    </>
  ),
  // A helper beside a person walking with a cane
  walking: (
    <>
      <circle cx="43" cy="11" r="4.5" fill="currentColor" stroke="none" />
      <path d="M43 19 V38 L38 53 M43 38 L48 53" />
      <path d="M43 24 L55 31 V53" />
      <circle cx="18" cy="13" r="4.5" fill="currentColor" stroke="none" />
      <path d="M18 21 V39 L13 53 M18 39 L23 53" />
      <path d="M18 25 L41 29" />
    </>
  ),
  // A person climbing stairs
  stairs: (
    <>
      <path d="M6 54 H20 V44 H34 V34 H48 V24 H58" />
      <circle cx="30" cy="8" r="4.5" fill="currentColor" stroke="none" />
      <path d="M30 16 V28 L26 44 M30 28 L38 26 V34" />
      <path d="M30 19 L41 16" />
    </>
  ),
  // A person in bed under drops of water
  bedBath: (
    <>
      <path d="M6 32 V56 M6 48 H58 M58 42 V56" />
      <circle cx="15" cy="41" r="4.5" fill="currentColor" stroke="none" />
      <path d="M22 48 V43 Q22 40 25 40 H50 Q54 40 54 44 V48" />
      <path d="M26 9 c3 4.5 4.5 6.5 4.5 9 a4.5 4.5 0 0 1 -9 0 c0 -2.5 1.5 -4.5 4.5 -9 z" />
      <path d="M38 15 c3 4.5 4.5 6.5 4.5 9 a4.5 4.5 0 0 1 -9 0 c0 -2.5 1.5 -4.5 4.5 -9 z" />
      <path d="M50 9 c3 4.5 4.5 6.5 4.5 9 a4.5 4.5 0 0 1 -9 0 c0 -2.5 1.5 -4.5 4.5 -9 z" />
    </>
  ),
  // A shower head and its spray
  shower: (
    <>
      <path d="M14 56 V14 a6 6 0 0 1 6 -6 H30 a6 6 0 0 1 6 6 V16" />
      <path d="M26 22 a10 6 0 0 1 20 0 Z" />
      <path d="M30 28 l-1.5 5 M36 28 v5 M42 28 l1.5 5 M27 38 l-1.5 5 M36 38 v5 M45 38 l1.5 5 M24 48 l-1.5 5 M36 48 v5 M48 48 l1.5 5" />
    </>
  ),
  // A capsule and a cup of water
  medication: (
    <>
      <rect x="9" y="19" width="28" height="13" rx="6.5" transform="rotate(-40 23 25.5)" />
      <path d="M23 19 V32" transform="rotate(-40 23 25.5)" />
      <path d="M36 30 H58 L55 56 H39 Z" />
      <path d="M37.2 40 H56.8" />
    </>
  ),
  // A person moving one arm up and down
  rangeOfMotion: (
    <>
      <circle cx="26" cy="12" r="4.5" fill="currentColor" stroke="none" />
      <path d="M26 20 V42 L20 57 M26 42 L32 57" />
      <path d="M26 24 L16 36" />
      <path d="M26 24 L37.6 37.8" />
      <path d="M29.5 19.8 L37.6 10.2" strokeDasharray="0.5 5.5" />
      <path d="M47.3 38.9 A26 26 0 0 0 47.3 9.1" />
      <path d="M47.3 15.1 L47.3 9.1 L52.9 11.2 M47.3 32.9 L47.3 38.9 L52.9 36.8" />
    </>
  ),
  // A person in bed with an arrow turning them
  positioning: (
    <>
      <path d="M6 32 V56 M6 48 H58 M58 42 V56" />
      <circle cx="15" cy="41" r="4.5" fill="currentColor" stroke="none" />
      <path d="M22 48 V43 Q22 40 25 40 H50 Q54 40 54 44 V48" />
      <path d="M22 28 C26 12 44 12 48 26" />
      <path d="M50 20.3 L48 26 L43.3 22.2" />
    </>
  ),
  // A glove being pulled off
  glove: (
    <>
      <path d="M20 56 V22 a3 3 0 0 1 6 0 V30 M26 30 V15 a3 3 0 0 1 6 0 V30 M32 30 V12 a3 3 0 0 1 6 0 V30 M38 30 V15 a3 3 0 0 1 6 0 V35 l5.5 -5.5 a3 3 0 0 1 4.5 4 L44 47 V56" />
      <path d="M20 49 H44 M20 56 H44" />
      <path d="M54 42 V56 M49.5 51.5 L54 56 L58.5 51.5" />
    </>
  ),
  // Two seats with an arrow from one to the other
  transfer: (
    <>
      <path d="M8 28 V52 M8 40 H22 V52" />
      <path d="M56 28 V52 M56 40 H42 V52" />
      <path d="M18 30 C24 14 40 14 46 30" />
      <path d="M47.5 24.2 L46 30 L41.1 26.6" />
    </>
  ),
  // A person walking
  mobility: (
    <>
      <circle cx="32" cy="10" r="4.5" fill="currentColor" stroke="none" />
      <path d="M32 18 V36 L25 54 M32 36 L40 54" />
      <path d="M32 23 L23 32 M32 23 L41 31" />
    </>
  ),
  // Drops of water
  hygiene: (
    <>
      <path d="M22 10 c3 4.5 4.5 6.5 4.5 9 a4.5 4.5 0 0 1 -9 0 c0 -2.5 1.5 -4.5 4.5 -9 z" />
      <path d="M43 12 c3 4.5 4.5 6.5 4.5 9 a4.5 4.5 0 0 1 -9 0 c0 -2.5 1.5 -4.5 4.5 -9 z" />
      <path d="M32 34 c3 4.5 4.5 6.5 4.5 9 a4.5 4.5 0 0 1 -9 0 c0 -2.5 1.5 -4.5 4.5 -9 z" />
    </>
  ),
  // A glove
  infectionControl: (
    <>
      <path d="M20 56 V22 a3 3 0 0 1 6 0 V30 M26 30 V15 a3 3 0 0 1 6 0 V30 M32 30 V12 a3 3 0 0 1 6 0 V30 M38 30 V15 a3 3 0 0 1 6 0 V35 l5.5 -5.5 a3 3 0 0 1 4.5 4 L44 47 V56" />
      <path d="M20 49 H44 M20 56 H44" />
    </>
  ),
  // A warning sign
  emergency: (
    <>
      <path d="M32 8 L58 54 H6 Z" />
      <path d="M32 25 V39" />
      <circle cx="32" cy="46" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  // A checklist
  other: (
    <>
      <rect x="14" y="12" width="36" height="44" rx="4" />
      <path d="M25 12 V10 a3 3 0 0 1 3 -3 h8 a3 3 0 0 1 3 3 V12" />
      <path d="M22 28 l3.5 3.5 l6 -6.5 M37 29 H43 M22 43 l3.5 3.5 l6 -6.5 M37 44 H43" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type SkillIconKind = keyof typeof drawings;

/**
 * Which pictogram a skill gets, from the words in its name. The first rule that matches
 * wins, so the more specific ones come first ("bed to wheelchair transfer" before
 * "wheelchair", "fall recovery positioning" before "positioning").
 */
const byWords: Array<[RegExp, SkillIconKind]> = [
  [/wheelchair.*\b(transfer|bed)\b|\b(transfer|bed)\b.*wheelchair/, "wheelchairTransfer"],
  [/\b(vehicle|car)\b/, "vehicle"],
  [/wheelchair/, "wheelchair"],
  [/\bstairs?\b/, "stairs"],
  [/\bsit to stand\b|\bstand(ing)?\b/, "sitToStand"],
  [/\bgait belt\b/, "gaitBelt"],
  [/\b(walk(ing)?|ambulat\w*|gait)\b/, "walking"],
  [/\bshower\w*\b/, "shower"],
  [/\b(bath\w*|wash\w*)\b/, "bedBath"],
  [/\bgloves?\b/, "glove"],
  [/\b(medic\w*|pills?|tablets?|oral)\b/, "medication"],
  [/\bfall\w*\b/, "fall"],
  [/\b(range of motion|exercis\w*|stretch\w*)\b/, "rangeOfMotion"],
  [/\b(re)?position\w*\b|\bturn\w*\b/, "positioning"],
  [/\btransfer\w*\b/, "transfer"],
];

/** For a skill whose name matches none of the rules: a pictogram for its category. */
const byCategory: Record<string, SkillIconKind> = {
  transfer: "transfer",
  mobility: "mobility",
  positioning: "positioning",
  hygiene: "hygiene",
  infection_control: "infectionControl",
  emergency: "emergency",
};

export function skillIconKind(skill: { slug: string; name: string; category: string }): SkillIconKind {
  const words = `${skill.slug} ${skill.name}`.toLowerCase().replace(/[_-]+/g, " ");
  return byWords.find(([pattern]) => pattern.test(words))?.[1] ?? byCategory[skill.category] ?? "other";
}

/** The pictogram for a skill. It is decoration: say the skill's name in text beside it. */
export function SkillIcon({
  skill,
  className,
}: {
  skill: { slug: string; name: string; category: string };
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("text-black", className)}
    >
      {drawings[skillIconKind(skill)]}
    </svg>
  );
}
