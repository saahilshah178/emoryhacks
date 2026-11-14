export type Role = "caregiver" | "nurse";

function hostname() {
  return typeof window === "undefined" ? "localhost" : window.location.hostname;
}

export const LOGIN_PATH = "/login";
export const SIGNUP_PATH = "/signup";

export function loginUrl() {
  return `http://${hostname()}:3000${LOGIN_PATH}`;
}

export function signupUrl() {
  return `http://${hostname()}:3000${SIGNUP_PATH}`;
}

export function landingUrl() {
  return `http://${hostname()}:3000/`;
}

export function landingAfterSignOutUrl() {
  return `${landingUrl()}?signedout=1`;
}

export function caregiverHomeUrl() {
  return `http://${hostname()}:3002/`;
}

export function dashboardHomeUrl() {
  return `http://${hostname()}:3001/`;
}

export function homeUrlFor(role: Role) {
  return role === "nurse" ? dashboardHomeUrl() : caregiverHomeUrl();
}
