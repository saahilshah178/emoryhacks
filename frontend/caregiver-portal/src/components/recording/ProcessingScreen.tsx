import { APP_NAME } from "@/config/branding";

export function ProcessingScreen({ skillName }: { skillName: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <span className="relative flex h-14 w-14">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-soft" />
        <span className="relative m-auto h-10 w-10 animate-spin rounded-full border-[3px] border-teal-soft border-t-teal" />
      </span>
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-navy">
        Looking over your movements…
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">
        {APP_NAME} is comparing your {skillName.toLowerCase()} with the nurse-approved
        example. A nurse will still make the final decision.
      </p>
    </div>
  );
}
