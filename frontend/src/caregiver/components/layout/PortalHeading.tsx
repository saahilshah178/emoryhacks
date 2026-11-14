import type { ComponentProps } from "react";
import { BackLink } from "@/shared/layout/BackLink";
import { PageHeading } from "@/shared/layout/PageHeading";

/**
 * The portal's page heading: the dashboard's, with a larger title on a phone where it is
 * the first thing on a small screen.
 */
export function PortalHeading(props: Omit<ComponentProps<typeof PageHeading>, "titleClassName">) {
  return <PageHeading {...props} titleClassName="text-2xl lg:text-xl" />;
}

/**
 * "Back to my skills" above a page's heading, on a laptop. On a phone these pages take
 * the whole screen and end with their own Back button.
 */
export function BackToSkills() {
  return (
    <div className="hidden lg:block">
      <BackLink href="/portal/skills">Back to my skills</BackLink>
    </div>
  );
}
