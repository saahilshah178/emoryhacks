import type { Role } from "./urls";

export type Session = {
  role: Role;
  name: string;
  email: string;
};

const COOKIE = "pn_session";

export function readSession(): Session | null {
  if (typeof document === "undefined") return null;
  const row = document.cookie.split("; ").find((part) => part.startsWith(`${COOKIE}=`));
  if (!row) return null;
  try {
    return JSON.parse(decodeURIComponent(row.slice(COOKIE.length + 1))) as Session;
  } catch {
    return null;
  }
}

export function writeSession(session: Session) {
  document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(session))}; path=/; max-age=604800; SameSite=Lax`;
}

export function clearSession() {
  document.cookie = `${COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  document.cookie = `${COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}
