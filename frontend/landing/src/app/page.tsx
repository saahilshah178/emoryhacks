"use client";

import { useEffect } from "react";
import { useAuth } from "@/shared/AuthProvider";
import { MarketingPage } from "@/shared/MarketingPage";
import { homeUrlFor } from "@/shared/urls";

export default function LandingPage() {
  const { ready, session } = useAuth();

  useEffect(() => {
    if (!ready || !session) return;
    window.location.href = homeUrlFor(session.role);
  }, [ready, session]);

  if (ready && session) {
    return <div className="min-h-dvh bg-page" />;
  }

  return <MarketingPage />;
}
