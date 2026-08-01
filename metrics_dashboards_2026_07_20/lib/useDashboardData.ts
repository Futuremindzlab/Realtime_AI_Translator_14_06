"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@/lib/cognitoAuth";
import { loadStoredSession } from "@/lib/session";

export interface DashboardData<T> {
  /** null until the stored session has been read (`checkedStorage`). */
  session: Session | null;
  setSession: (s: Session) => void;
  /** False during the first render pass, when sessionStorage is not readable yet. */
  checkedStorage: boolean;
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Restores the stored Cognito session, loads the dashboard payload for it, and
 * reloads whenever the session changes or the caller asks for a refresh.
 */
export function useDashboardData<T>(
  load: (session: Session) => Promise<T>,
  errorMessage: string
): DashboardData<T> {
  const [session, setSession] = useState<Session | null>(null);
  const [checkedStorage, setCheckedStorage] = useState(false);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSession(loadStoredSession());
    setCheckedStorage(true);
  }, []);

  const fetchData = useCallback(
    async (s: Session) => {
      setLoading(true);
      setError(null);
      try {
        setData(await load(s));
      } catch (err) {
        setError(err instanceof Error ? err.message : errorMessage);
      } finally {
        setLoading(false);
      }
    },
    [load, errorMessage]
  );

  useEffect(() => {
    if (session) fetchData(session);
  }, [session, fetchData]);

  const reload = useCallback(() => {
    if (session) fetchData(session);
  }, [session, fetchData]);

  return { session, setSession, checkedStorage, data, error, loading, reload };
}
