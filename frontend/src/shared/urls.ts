import type { Role } from "@/lib/types";

export type { Role };

export const LOGIN_PATH = "/login";
export const DASHBOARD_HOME = "/dashboard";
export const PORTAL_HOME = "/portal";

export function landingUrl() {
  return "/";
}

export function homeUrlFor(role: Role) {
  return role === "nurse" ? DASHBOARD_HOME : PORTAL_HOME;
}
