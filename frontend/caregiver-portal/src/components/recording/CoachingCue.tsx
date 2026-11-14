import { MessageCircleHeart } from "lucide-react";

export function CoachingCue({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-10">
      <div className="flex items-start gap-2 rounded-[12px] bg-card/95 px-3 py-2.5 shadow-[0_1px_3px_rgba(23,50,77,0.12)] ring-1 ring-border">
        <MessageCircleHeart className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden />
        <p className="text-sm font-medium leading-snug text-navy">{message}</p>
      </div>
    </div>
  );
}
