import { cn } from "@/nurse/lib/cn";

const palettes = [
  "bg-teal-soft text-teal",
  "bg-info-bg text-info",
  "bg-success-bg text-success",
  "bg-warning-bg text-warning",
];

export function Avatar({
  name,
  initials,
  size = "md",
  className,
}: {
  name: string;
  initials?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const computed =
    initials ??
    name
      .split(" ")
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  const tone = palettes[name.length % palettes.length];

  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "sm" && "h-7 w-7 text-[11px]",
        size === "md" && "h-9 w-9 text-xs",
        size === "lg" && "h-11 w-11 text-sm",
        tone,
        className,
      )}
    >
      {computed}
    </span>
  );
}
