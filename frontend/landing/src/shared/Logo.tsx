import { APP_NAME } from "./brand";

export function Logo({
  href = "/",
  light = false,
}: {
  href?: string;
  light?: boolean;
}) {
  return (
    <a href={href} aria-label={APP_NAME} className="flex min-h-11 shrink-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-teal text-sm font-semibold text-white">
        {APP_NAME.charAt(0)}
      </span>
      <span
        className={`truncate text-[15px] font-semibold tracking-tight ${light ? "text-white" : "text-navy"}`}
      >
        {APP_NAME}
      </span>
    </a>
  );
}
