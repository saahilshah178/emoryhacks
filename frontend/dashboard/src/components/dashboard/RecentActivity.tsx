import Link from "next/link";
import { BadgeCheck, ClipboardPen, ShieldAlert, Sparkles } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { activityEvents } from "@/lib/mock-data";
import { cn } from "@/lib/cn";

const icons = {
  submission: ClipboardPen,
  safety: ShieldAlert,
  approval: BadgeCheck,
  first_assessment: Sparkles,
};

const tones = {
  submission: "bg-info-bg text-info",
  safety: "bg-danger-bg text-danger",
  approval: "bg-success-bg text-success",
  first_assessment: "bg-teal-soft text-teal",
};

export function RecentActivity() {
  return (
    <Card className="h-full">
      <CardHeader>
        <div>
          <CardTitle>Recent activity</CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">Live clinical events from this week.</p>
        </div>
      </CardHeader>
      <CardBody className="space-y-1">
        {activityEvents.map((event) => {
          const Icon = icons[event.type];
          const content = (
            <div className="flex gap-3 rounded-[12px] p-2.5 hover:bg-page">
              <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", tones[event.type])}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{event.message}</p>
                <p className="mt-0.5 text-xs text-ink-secondary">{event.detail}</p>
                <p className="mt-1 text-[11px] text-ink-muted">{event.relativeLabel}</p>
              </div>
            </div>
          );
          return event.href ? (
            <Link key={event.id} href={event.href} className="block">
              {content}
            </Link>
          ) : (
            <div key={event.id}>{content}</div>
          );
        })}
      </CardBody>
    </Card>
  );
}
