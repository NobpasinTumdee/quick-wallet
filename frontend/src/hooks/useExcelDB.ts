import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, QueryParams, api, buildPath } from '../api/client';

/**
 * Data-fetching hooks for the Excel-backed API.
 *
 * `useExcelQuery`  — read one endpoint (dashboard, settings, …)
 * `useExcelDB`     — full CRUD over a collection endpoint (wallets, budgets, …)
 *
 * Both are deliberately small: the workbook lives on localhost, so requests are
 * sub-millisecond and there is no need for a caching library.
 */

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  /** True only for the very first load — use it to show skeletons, not spinners. */
  initialLoading: boolean;
  error: string | null;
  errorCode: string | null;
  refresh: () => Promise<void>;
}

interface QueryOptions {
  enabled?: boolean;
  /** Poll interval in ms. Omit for no polling. */
  refreshInterval?: number;
}

export function useExcelQuery<T>(
  path: string,
  params?: QueryParams,
  options: QueryOptions = {},
): QueryState<T> {
  const { enabled = true, refreshInterval } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [initialLoading, setInitialLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Serialising params keeps the effect from re-firing on every render when the
  // caller passes an inline object literal.
  const key = useMemo(() => buildPath(path, params), [path, JSON.stringify(params ?? {})]);

  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!enabled) return;
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await api.get<T>(key);
      // A newer request already started — throw this result away.
      if (id !== requestId.current || !mounted.current) return;
      setData(result);
      setError(null);
      setErrorCode(null);
    } catch (err) {
      if (id !== requestId.current || !mounted.current) return;
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Request failed');
      setErrorCode(err instanceof ApiError ? err.code : 'UNKNOWN');
    } finally {
      if (id === requestId.current && mounted.current) {
        setLoading(false);
        setInitialLoading(false);
      }
    }
  }, [key, enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setInitialLoading(false);
      return;
    }
    void run();
  }, [run, enabled]);

  useEffect(() => {
    if (!enabled || !refreshInterval) return undefined;
    const timer = window.setInterval(() => void run(), refreshInterval);
    return () => window.clearInterval(timer);
  }, [run, enabled, refreshInterval]);

  return { data, loading, initialLoading, error, errorCode, refresh: run };
}

export interface CollectionState<T> extends QueryState<T[]> {
  items: T[];
  /** True while a create/update/delete is in flight. */
  mutating: boolean;
  mutationError: string | null;
  clearMutationError: () => void;
  create: (payload: Partial<T> | Record<string, unknown>) => Promise<T>;
  update: (id: string, payload: Partial<T> | Record<string, unknown>) => Promise<T>;
  remove: (id: string, params?: QueryParams) => Promise<void>;
  /** POST to `/{resource}/{id}/{action}` — used by things like "sell position". */
  action: <R = T>(id: string, actionName: string, payload?: unknown) => Promise<R>;
}

export function useExcelDB<T extends { id: string }>(
  resource: string,
  params?: QueryParams,
  options: QueryOptions = {},
): CollectionState<T> {
  const path = `/api/${resource}`;
  const query = useExcelQuery<T[]>(path, params, options);

  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const wrap = useCallback(
    async <R>(fn: () => Promise<R>): Promise<R> => {
      setMutating(true);
      setMutationError(null);
      try {
        const result = await fn();
        await query.refresh();
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong';
        setMutationError(message);
        // Re-thrown so forms can keep their values instead of closing.
        throw err;
      } finally {
        setMutating(false);
      }
    },
    [query.refresh],
  );

  const create = useCallback(
    (payload: Partial<T> | Record<string, unknown>) => wrap(() => api.post<T>(path, payload)),
    [wrap, path],
  );

  const update = useCallback(
    (id: string, payload: Partial<T> | Record<string, unknown>) =>
      wrap(() => api.patch<T>(`${path}/${id}`, payload)),
    [wrap, path],
  );

  const remove = useCallback(
    async (id: string, deleteParams?: QueryParams) => {
      await wrap(() => api.delete<{ ok: boolean }>(`${path}/${id}`, deleteParams));
    },
    [wrap, path],
  );

  const action = useCallback(
    <R,>(id: string, actionName: string, payload?: unknown) =>
      wrap(() => api.post<R>(`${path}/${id}/${actionName}`, payload)),
    [wrap, path],
  );

  return {
    ...query,
    items: query.data ?? [],
    mutating,
    mutationError,
    clearMutationError: () => setMutationError(null),
    create,
    update,
    remove,
    action,
  };
}
