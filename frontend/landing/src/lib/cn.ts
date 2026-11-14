import { twMerge } from "tailwind-merge";

/**
 * Join class names. When two classes set the same thing, the later one wins, so a
 * component's defaults can be overridden from outside: <Card className="bg-teal-soft">.
 */
export function cn(...classes: Array<string | false | null | undefined>) {
  return twMerge(classes.filter(Boolean).join(" "));
}
