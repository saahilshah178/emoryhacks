"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { homeUrlFor, landingAfterSignOutUrl } from "./urls";
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
    setSession(readSession());
    setReady(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      signIn: (next) => {
        writeSession(next);
        setSession(next);
        window.location.href = homeUrlFor(next.role);
      },
      signOut: () => {
        clearSession();
        window.location.assign(landingAfterSignOutUrl());
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
