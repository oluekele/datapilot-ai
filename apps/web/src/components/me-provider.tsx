"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, apiGet, loginUrlFor } from "@/lib/api";
import type { Me } from "@/lib/types";

type MeContextValue = {
  me: Me | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<Me | null>;
  setMe: (me: Me) => void;
};

const MeContext = createContext<MeContextValue | null>(null);

export function redirectToLogin(): void {
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(loginUrlFor(here));
}

/**
 * Loads GET /auth/me for an authenticated area. With `requireAuth`, a 401
 * sends the visitor to /login?next=<current page>.
 */
export function MeProvider({ children, requireAuth = true }: { children: ReactNode; requireAuth?: boolean }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async (): Promise<Me | null> => {
    try {
      const next = await apiGet<Me>("/auth/me");
      setMeState(next);
      setError(null);
      return next;
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, null, "Unable to load your account.");
      if (apiError.status === 401) {
        setMeState(null);
        if (requireAuth) redirectToLogin();
      }
      setError(apiError);
      return null;
    } finally {
      setLoading(false);
    }
  }, [requireAuth]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<MeContextValue>(
    () => ({ me, loading, error, refresh, setMe: setMeState }),
    [me, loading, error, refresh],
  );

  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe(): MeContextValue {
  const value = useContext(MeContext);
  if (!value) throw new Error("useMe must be used inside <MeProvider>");
  return value;
}

/** Convenience for pages that render only once `me` has loaded. */
export function useRequiredMe(): Me {
  const { me } = useMe();
  if (!me) throw new Error("useRequiredMe called before the account loaded");
  return me;
}
