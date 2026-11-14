"use client";

import { Film } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A still from a stored video, or a plain block when there is no frame to show (no
 * reference video, or the image fails to load). Decorative: the text beside it says what
 * it is.
 */
export function SkillThumb({ src, className }: { src: string | null; className?: string }) {
  // Remember which address failed, so a new address gets a fresh try.
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = src !== null && failed !== src;
  return (
    <div className={cn("relative aspect-video overflow-hidden bg-secondary", className)}>
      {showImage ? (
        // A frame served by our own API with the session cookie; next/image would need a loader for it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(src)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-ink-muted" aria-hidden>
          <Film className="h-6 w-6" />
        </div>
      )}
    </div>
  );
}
