export type Role = "caregiver" | "nurse";

export const LOGIN_PATH = "/login";
export const SIGNUP_PATH = "/signup";
export const DASHBOARD_HOME = "/dashboard";
export const PORTAL_HOME = "/portal";

export function loginUrl() {
  return LOGIN_PATH;
}

export function signupUrl() {
  return SIGNUP_PATH;
}

export function landingUrl() {
  return "/";
}

export function landingAfterSignOutUrl() {
  return "/";
}

export function caregiverHomeUrl() {
  return PORTAL_HOME;
}

export function dashboardHomeUrl() {
  return DASHBOARD_HOME;
}

export function homeUrlFor(role: Role) {
  return role === "nurse" ? DASHBOARD_HOME : PORTAL_HOME;
}
