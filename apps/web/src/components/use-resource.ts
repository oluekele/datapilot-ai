"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiGet } from "@/lib/api";
import { redirectToLogin } from "@/components/me-provider";

export type Resource<T> = {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (data: T) => void;
};

/** GET a resource for a protected page; null path skips loading. 401 → /login. */
export function useResource<T>(path: string | null): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async (target: string, signal?: AbortSignal) => {
    try {
      const result = await apiGet<T>(target, signal);
      if (pathRef.current !== target) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const apiError = err instanceof ApiError ? err : new ApiError(0, null, "Unable to load data.");
      if (apiError.status === 401) {
        redirectToLogin();
        return;
      }
      setError(apiError);
    } finally {
      if (pathRef.current === target) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void load(path, controller.signal);
    return () => controller.abort();
  }, [path, load]);

  const reload = useCallback(async () => {
    if (pathRef.current) await load(pathRef.current);
  }, [load]);

  return { data, error, loading, reload, setData };
}

/** Calls `tick` every `ms` while `active` is true. */
export function usePolling(active: boolean, tick: () => unknown, ms = 2000): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => void tickRef.current(), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
}
