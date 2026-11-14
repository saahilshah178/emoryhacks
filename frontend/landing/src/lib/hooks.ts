"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APP_NAME } from "@/shared/brand";
import { api, ApiError, errorMessage } from "./api";
import type { Job } from "./types";

type Result<T> = { path: string; data: T | undefined; error: string | null; status: number | null };

/**
 * Load JSON from the API. Pass null to skip.
 *
 *   const { data, error, status, loading, reload, setData } = useApi<Skill>(`/skills/${id}`);
 *
 * `loading` is true only until the first answer for this path; `reload()` fetches again and
 * keeps what is on screen meanwhile; `refreshMs` polls; `setData` replaces the copy on
 * screen after a write, without another round trip.
 */
export function useApi<T>(path: string | null, options: { refreshMs?: number } = {}) {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    api<T>(path)
      .then((data) => {
        if (!cancelled) setResult({ path, data, error: null, status: null });
      })
      .catch((error) => {
        if (cancelled) return;
        setResult((previous) => ({
          path,
          data: previous?.path === path ? previous.data : undefined,
          error: errorMessage(error),
          status: error instanceof ApiError ? error.status : null,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  const { refreshMs } = options;
  useEffect(() => {
    if (!refreshMs || path === null) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshMs, path]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  const setData = useCallback(
    (data: T) => {
      if (path !== null) setResult({ path, data, error: null, status: null });
    },
    [path],
  );

  // An answer for a different path belongs to something else, so it is not shown.
  const current = result !== null && result.path === path ? result : null;
  return {
    data: current?.data,
    error: current?.error ?? null,
    /** The HTTP status of a failed request (404 for "not found"), or null. */
    status: current?.status ?? null,
    loading: path !== null && current === null,
    reload,
    setData,
  };
}

const POLL_MS = 2000;

type JobState = { jobId: string; job: Job | null; failed: string | null };

/**
 * Follow a pipeline job until it finishes. `job` is its latest state; `failed` is a
 * sentence for the user when it ends in an error or the server stops answering.
 * onDone runs once, when the job finishes successfully.
 */
export function useJob(jobId: string | null, onDone?: (job: Job) => void) {
  const [state, setState] = useState<JobState | null>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let misses = 0;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await api<Job>(`/jobs/${jobId}`);
        if (cancelled) return;
        misses = 0;
        if (next.status === "error") {
          const reason = (next.error ?? "The video could not be processed.").split("\n")[0];
          setState({ jobId, job: next, failed: reason });
          return;
        }
        setState({ jobId, job: next, failed: null });
        if (next.status === "done") {
          done.current?.(next);
          return;
        }
      } catch (error) {
        if (cancelled) return;
        misses += 1;
        if (misses >= 5) {
          setState((previous) => ({
            jobId,
            job: previous?.jobId === jobId ? previous.job : null,
            failed: errorMessage(error),
          }));
          return;
        }
      }
      timer = window.setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobId]);

  const current = state !== null && state.jobId === jobId ? state : null;
  return { job: current?.job ?? null, failed: current?.failed ?? null };
}

/** Set the browser tab's title for a page: "Pending reviews · <product name>". */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · ${APP_NAME}`;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);
}
