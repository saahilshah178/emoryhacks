import { MessageCircleHeart } from "lucide-react";

/** A prompt from the skill's guide, shown over the camera while recording. */
export function CoachingCue({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-10" aria-live="polite">
      <div className="flex items-start gap-2 rounded-[12px] bg-white/95 px-3 py-2.5 shadow-[var(--shadow-card)] ring-1 ring-border">
        <MessageCircleHeart className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden />
        <p className="text-sm font-medium leading-snug text-navy">{message}</p>
      </div>
    </div>
  );
}
