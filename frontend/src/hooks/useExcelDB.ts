import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  getEntry,
  invalidate,
  mutateMatching,
  prefetch as prefetchKey,
  revalidate,
  subscribe,
} from '../api/cache';
import { QueryParams, api, buildPath } from '../api/client';
import { toast } from '../lib/toast';

/**
 * Data hooks for the Google Sheet API.
 *
 *   useExcelQuery  — read one endpoint, stale-while-revalidate
 *   useExcelDB     — full CRUD over a collection, with optimistic writes
 *
 * The public shape is unchanged from the pre-cache version, so no page needed
 * editing. What changed underneath:
 *
 *   - state lives in `api/cache.ts`, not in the component, so remounting a page
 *     paints from cache immediately and refreshes in the background
 *   - `initialLoading` is only true when there is genuinely nothing to show;
 *     a background refresh sets `isValidating` instead
 *   - create/update/delete patch the cache first and reconcile after, so the UI
 *     never waits on the 1–3s round trip; a failure rolls back and toasts
 */

/* ------------------------------------------------------------------ */
/* Resource metadata                                                   */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown> & { id: string };

/** Newest first, matching the server's `date + createdAt` ordering. */
function byDateDesc(dateField: string) {
  return (a: Row, b: Row) =>
    String(`${b[dateField] ?? ''}${b.createdAt ?? ''}`).localeCompare(
      String(`${a[dateField] ?? ''}${a.createdAt ?? ''}`),
    );
}

interface ResourceConfig {
  /** Cache prefixes to refresh once a write lands. */
  invalidates: string[];
  /** Keeps an optimistic row in the position the server would put it. */
  sort?: (a: Row, b: Row) => number;
}

const RESOURCES: Record<string, ResourceConfig> = {
  wallets: {
    invalidates: ['/api/wallets', '/api/dashboard'],
  },
  transactions: {
    // A transaction moves balances and budget progress too.
    invalidates: ['/api/transactions', '/api/wallets', '/api/budgets', '/api/dashboard'],
    sort: byDateDesc('date'),
  },
  investments: {
    invalidates: ['/api/investments', '/api/wallets', '/api/dashboard'],
    sort: byDateDesc('buyDate'),
  },
  budgets: {
    invalidates: ['/api/budgets', '/api/dashboard'],
  },
};

function configFor(resource: string): ResourceConfig {
  return RESOURCES[resource] ?? { invalidates: [`/api/${resource}`, '/api/dashboard'] };
}

/** Optimistic rows carry a temporary id until the server returns the real one. */
const OPTIMISTIC_PREFIX = 'optimistic:';

export function isOptimistic(row: { id?: string }): boolean {
  return typeof row?.id === 'string' && row.id.startsWith(OPTIMISTIC_PREFIX);
}

function temporaryId(): string {
  return `${OPTIMISTIC_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------------ */
/* useExcelQuery                                                       */
/* ------------------------------------------------------------------ */

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  /** True only when there is nothing cached to render — drives skeletons. */
  initialLoading: boolean;
  /** True while refreshing data that is already on screen. */
  isValidating: boolean;
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

  // Serialised so an inline object literal doesn't produce a new key each render.
  const key = useMemo(() => buildPath(path, params), [path, JSON.stringify(params ?? {})]);

  const entry = useSyncExternalStore(
    useCallback((onChange: () => void) => (enabled ? subscribe(key, onChange) : () => {}), [key, enabled]),
    useCallback(() => getEntry<T>(key), [key]),
    useCallback(() => getEntry<T>(key), [key]),
  );

  useEffect(() => {
    if (!enabled) return;
    void revalidate<T>(key);
  }, [key, enabled]);

  useEffect(() => {
    if (!enabled || !refreshInterval) return undefined;
    const timer = window.setInterval(() => void revalidate<T>(key, { force: true }), refreshInterval);
    return () => window.clearInterval(timer);
  }, [key, enabled, refreshInterval]);

  const refresh = useCallback(async () => {
    await revalidate<T>(key, { force: true });
  }, [key]);

  const hasData = entry.data !== undefined;

  return {
    data: hasData ? (entry.data as T) : null,
    loading: entry.validating,
    initialLoading: enabled && !hasData && entry.error === null,
    isValidating: entry.validating && hasData,
    error: entry.error,
    errorCode: entry.errorCode,
    refresh,
  };
}

/* ------------------------------------------------------------------ */
/* useExcelDB                                                          */
/* ------------------------------------------------------------------ */

export interface CollectionState<T> extends QueryState<T[]> {
  items: T[];
  /** True while a create/update/delete is settling on the server. */
  mutating: boolean;
  mutationError: string | null;
  clearMutationError: () => void;
  create: (payload: Partial<T> | Record<string, unknown>) => Promise<T>;
  update: (id: string, payload: Partial<T> | Record<string, unknown>) => Promise<T>;
  remove: (id: string, params?: QueryParams) => Promise<void>;
  /** POST to `/{resource}/{id}/{action}` — e.g. "sell position". */
  action: <R = T>(id: string, actionName: string, payload?: unknown) => Promise<R>;
}

export function useExcelDB<T extends { id: string }>(
  resource: string,
  params?: QueryParams,
  options: QueryOptions = {},
): CollectionState<T> {
  const path = `/api/${resource}`;
  const query = useExcelQuery<T[]>(path, params, options);
  const config = useMemo(() => configFor(resource), [resource]);

  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * The heart of the optimistic flow.
   *
   * 1. patch every cached copy of this resource straight away
   * 2. fire the request
   * 3. on success, reconcile with the server row and refresh derived views
   * 4. on failure, roll the cache back to exactly what it was and toast
   */
  const optimistic = useCallback(
    async <R>(
      apply: (rows: T[]) => T[],
      send: () => Promise<R>,
      reconcile?: (rows: T[], result: R) => T[],
      failureTitle?: string,
    ): Promise<R> => {
      const rollback = mutateMatching<T[]>(path, (rows) => apply(rows ?? []));

      setMutating(true);
      setMutationError(null);

      try {
        const result = await send();
        if (reconcile) mutateMatching<T[]>(path, (rows) => reconcile(rows ?? [], result));
        // Balances, budget progress and the dashboard are all derived from this
        // write, so refresh whatever the user is currently looking at.
        invalidate(config.invalidates);
        return result;
      } catch (err) {
        rollback();
        const message = err instanceof Error ? err.message : 'Something went wrong';
        if (mounted.current) setMutationError(message);
        toast.error(message, failureTitle);
        // Re-thrown so forms can keep their values instead of closing.
        throw err;
      } finally {
        if (mounted.current) setMutating(false);
      }
    },
    [path, config],
  );

  const sortRows = useCallback(
    (rows: T[]) => (config.sort ? [...rows].sort(config.sort as (a: T, b: T) => number) : rows),
    [config],
  );

  const create = useCallback(
    (payload: Partial<T> | Record<string, unknown>) => {
      const draft = {
        ...(payload as Record<string, unknown>),
        id: temporaryId(),
        createdAt: new Date().toISOString(),
      } as unknown as T;

      return optimistic<T>(
        (rows) => sortRows([draft, ...rows]),
        () => api.post<T>(path, payload),
        // Swap the placeholder for the server's row (real id, computed fields).
        (rows, saved) => sortRows(rows.map((row) => (row.id === draft.id ? saved : row))),
        'Could not save',
      );
    },
    [optimistic, sortRows, path],
  );

  const update = useCallback(
    (id: string, payload: Partial<T> | Record<string, unknown>) =>
      optimistic<T>(
        (rows) =>
          sortRows(
            rows.map((row) =>
              row.id === id ? ({ ...row, ...(payload as Record<string, unknown>) } as T) : row,
            ),
          ),
        () => api.patch<T>(`${path}/${id}`, payload),
        (rows, saved) => sortRows(rows.map((row) => (row.id === id ? saved : row))),
        'Could not save',
      ),
    [optimistic, sortRows, path],
  );

  const remove = useCallback(
    async (id: string, deleteParams?: QueryParams) => {
      await optimistic<{ ok: boolean }>(
        (rows) => rows.filter((row) => row.id !== id),
        () => api.delete<{ ok: boolean }>(`${path}/${id}`, deleteParams),
        undefined,
        'Could not delete',
      );
    },
    [optimistic, path],
  );

  const action = useCallback(
    <R,>(id: string, actionName: string, payload?: unknown) =>
      optimistic<R>(
        // The server owns the resulting shape here, so only mark the row busy;
        // the reconcile step below writes the real values.
        (rows) => rows,
        () => api.post<R>(`${path}/${id}/${actionName}`, payload),
        (rows, saved) =>
          sortRows(rows.map((row) => (row.id === id ? ({ ...row, ...(saved as object) } as T) : row))),
        'Action failed',
      ),
    [optimistic, sortRows, path],
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

/* ------------------------------------------------------------------ */
/* Prefetching                                                         */
/* ------------------------------------------------------------------ */

/** Warms a path before it is needed — e.g. on nav hover. */
export function prefetch(path: string, params?: QueryParams): void {
  prefetchKey(buildPath(path, params));
}
