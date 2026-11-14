export type Role = "caregiver" | "nurse";

export const LOGIN_PATH = "/login";
export const SIGNUP_PATH = "/signup";

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
  return "/";
}

export function dashboardHomeUrl() {
  return "/";
}

export function homeUrlFor(_role: Role) {
  return "/";
}
