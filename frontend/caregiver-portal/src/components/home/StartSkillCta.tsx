import { Video } from "lucide-react";
import { APP_NAME } from "@/config/branding";
import { Button } from "@/components/ui/Button";

export function StartSkillCta({ href }: { href: string }) {
  return (
    <section className="rounded-[12px] bg-navy p-5 text-white shadow-[0_1px_3px_rgba(23,50,77,0.12)]">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-teal">
          <Video className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-lg font-semibold leading-snug">
            Ready to demonstrate a skill?
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-white/75">
            Record yourself performing a caregiving skill and get feedback from{" "}
            {APP_NAME}.
          </p>
        </div>
      </div>
      <Button href={href} className="mt-5 w-full" size="lg">
        Start a Skill Check
      </Button>
    </section>
  );
}
