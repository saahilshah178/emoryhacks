"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { homeUrlFor, landingUrl } from "./urls";
import { clearSession, readSession, writeSession, type Session } from "./session";
import type { Role } from "./urls";

type AuthContextValue = {
  ready: boolean;
  session: Session | null;
  signIn: (session: Session) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const signedOut =
      new URLSearchParams(window.location.search).get("signedout") === "1";
    if (signedOut) {
      clearSession();
      setSession(null);
      window.history.replaceState({}, "", "/");
    } else {
      setSession(readSession());
    }
    setReady(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      signIn: (next) => {
        writeSession(next);
        setSession(next);
        window.location.assign(homeUrlFor(next.role));
      },
      signOut: () => {
        clearSession();
        window.location.assign(landingUrl());
      },
    }),
    [ready, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

export function demoUser(role: Role): Session {
  return role === "nurse"
    ? { role, name: "Patricia Chen", email: "p.chen@harborhomecare.example" }
    : { role, name: "Sarah Chen", email: "s.chen@harborhomecare.example" };
}
