import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

const palettes = ["bg-teal-soft text-teal", "bg-info-bg text-info", "bg-success-bg text-success", "bg-warning-bg text-warning"];

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "sm" && "h-7 w-7 text-[11px]",
        size === "md" && "h-9 w-9 text-xs",
        size === "lg" && "h-11 w-11 text-sm",
        size === "xl" && "h-16 w-16 text-lg",
        palettes[name.length % palettes.length],
        className,
      )}
    >
      {initials(name) || "?"}
    </span>
  );
}
