"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

type Refresh = {
  /** How many times the page has been refreshed since it was opened. */
  count: number;
  /** Load everything inside the boundary again, from the top of the page. */
  refresh: () => void;
};

const RefreshContext = createContext<Refresh>({ count: 0, refresh: () => {} });

/**
 * Wraps a portal's data provider and shell. refresh() starts everything inside again, the
 * way reloading the page would: the data is fetched afresh and each section shows its
 * loading state until its answer arrives. The sign-in above the boundary is kept.
 */
export function RefreshBoundary({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const clearTimer = useRef(0);

  const refresh = useCallback(() => {
    setCount((value) => value + 1);
    window.scrollTo({ top: 0 });
    // Said once for screen readers, then cleared so the next refresh is announced too.
    setAnnouncement("Page refreshed");
    window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => setAnnouncement(""), 2000);
  }, []);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);

  return (
    <RefreshContext.Provider value={value}>
      {/* A new key discards what was loaded and mounts the children again. */}
      <Fragment key={count}>{children}</Fragment>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </RefreshContext.Provider>
  );
}

/**
 * For the brand link in a shell. On any other page the link goes home as usual. On the
 * home page itself there is nowhere to go, so a click refreshes it instead.
 *
 *   const brand = useHomeLink("/dashboard");
 *   <Logo href="/dashboard" onClick={brand.onClick} />
 *   <div className={brand.contentClassName}>{children}</div>
 */
export function useHomeLink(home: string) {
  const pathname = usePathname();
  const { count, refresh } = useContext(RefreshContext);
  const atHome = (pathname.replace(/\/+$/, "") || "/") === home;

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!atHome) return;
    // Opening the link in a new tab or window is left to the browser.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    refresh();
  }

  return {
    onClick,
    /** For the page content: it fades in when it comes back after a refresh, not on first load. */
    contentClassName: count > 0 ? "animate-refresh-in motion-reduce:animate-none" : undefined,
  };
}
