"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import type { Role, User } from "@/lib/types";
import { homeUrlFor, landingUrl } from "./urls";

type SignUpDetails = { role: Role; name: string; email: string; password: string; join_code?: string };

type AuthContextValue = {
  /** False until the first check of who is signed in has finished. */
  ready: boolean;
  user: User | null;
  /** Both throw an ApiError with a sentence for the user when they fail. */
  signIn: (username: string, password: string) => Promise<User>;
  signUp: (details: SignUpDetails) => Promise<User>;
  /** Move into the agency that owns this code. Throws an ApiError with a sentence when it fails. */
  joinAgency: (code: string) => Promise<User>;
  signOut: () => Promise<void>;
  /** Replace the signed-in user after a profile or agency change. */
  setUser: (user: User) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ user: User | null }>("/auth/session")
      .then((session) => {
        if (!cancelled) setUser(session.user);
      })
      .catch((error) => {
        // The API is unreachable. The visitor is treated as signed out; protected pages
        // send them to the login screen, which reports the problem when they try to log in.
        if (!cancelled && !(error instanceof ApiError)) console.error(error);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const me = await api<User>("/auth/login", { json: { username, password } });
    setUser(me);
    return me;
  }, []);

  const signUp = useCallback(async (details: SignUpDetails) => {
    const me = await api<User>("/auth/signup", { json: details });
    setUser(me);
    return me;
  }, []);

  const joinAgency = useCallback(async (code: string) => {
    const me = await api<User>("/org/join", { json: { code } });
    setUser(me);
    return me;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      // A full navigation, so nothing from the signed-in session stays in memory.
      window.location.assign(landingUrl());
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ready, user, signIn, signUp, joinAgency, signOut, setUser }),
    [ready, user, signIn, signUp, joinAgency, signOut],
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

/** The signed-in user inside /portal and /dashboard, where the layout guarantees there is one. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("useUser needs a signed-in user");
  return user;
}

export { homeUrlFor };
