/**
 * A small stale-while-revalidate cache.
 *
 * Apps Script answers in 1–3s, so the old "fetch on every mount" model meant a
 * spinner every time you switched tabs or reopened a month you had already
 * looked at. This store keeps responses in module scope — outside React — so:
 *
 *   - remounting a page renders instantly from cache, then refreshes silently
 *   - two components asking for the same key share one in-flight request
 *   - a write can patch every cached copy of a row before the network replies
 *
 * The cache key is the request path itself (`/api/wallets?includeArchived=true`),
 * which is exactly what `buildPath()` already produced.
 *
 * Deliberately not React Query: the hooks here expose a bespoke surface used by
 * seven screens, so a library would mean rewriting every call site to gain
 * features (suspense, infinite queries, devtools) this app has no use for.
 */

import { ApiError, api } from './client';

export interface CacheEntry<T = unknown> {
  data: T | undefined;
  error: string | null;
  errorCode: string | null;
  /** When `data` last came back from the network. 0 = never. */
  updatedAt: number;
  /** A request is in flight for this key right now. */
  validating: boolean;
}

const EMPTY: CacheEntry = {
  data: undefined,
  error: null,
  errorCode: null,
  updatedAt: 0,
  validating: false,
};

const store = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<unknown>>();
/** How many mounted hooks care about each key — drives focus revalidation. */
const refCounts = new Map<string, number>();

/** Requests for the same key inside this window reuse the last result. */
const DEDUPE_MS = 2000;

/* ------------------------------------------------------------------ */
/* Subscription                                                        */
/* ------------------------------------------------------------------ */

export function subscribe(key: string, onChange: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onChange);
  refCounts.set(key, (refCounts.get(key) ?? 0) + 1);

  return () => {
    set!.delete(onChange);
    if (!set!.size) listeners.delete(key);
    const next = (refCounts.get(key) ?? 1) - 1;
    if (next <= 0) refCounts.delete(key);
    else refCounts.set(key, next);
  };
}

function emit(key: string): void {
  const set = listeners.get(key);
  if (set) set.forEach((fn) => fn());
}

/** Snapshot for useSyncExternalStore. Identity is stable until the key changes. */
export function getEntry<T>(key: string): CacheEntry<T> {
  return (store.get(key) as CacheEntry<T>) ?? (EMPTY as CacheEntry<T>);
}

function patch(key: string, next: Partial<CacheEntry>): void {
  const current = store.get(key) ?? EMPTY;
  store.set(key, { ...current, ...next });
  emit(key);
}

export function hasData(key: string): boolean {
  return store.get(key)?.data !== undefined;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

interface RevalidateOptions {
  /** Ignore the dedupe window and fetch regardless of freshness. */
  force?: boolean;
}

/**
 * Fetches a key unless a recent result or an in-flight request already covers
 * it. Resolves with the cached/fresh data; never throws — errors land on the
 * entry so subscribers can render them.
 */
export function revalidate<T>(key: string, options: RevalidateOptions = {}): Promise<T | undefined> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T | undefined>;

  const entry = store.get(key);
  const fresh = entry && entry.updatedAt > 0 && Date.now() - entry.updatedAt < DEDUPE_MS;
  if (fresh && !options.force) return Promise.resolve(entry!.data as T);

  patch(key, { validating: true });

  const request = api
    .get<T>(key)
    .then((data) => {
      store.set(key, {
        data,
        error: null,
        errorCode: null,
        updatedAt: Date.now(),
        validating: false,
      });
      emit(key);
      return data;
    })
    .catch((err: unknown) => {
      if ((err as Error)?.name === 'AbortError') return undefined;
      const current = store.get(key) ?? EMPTY;
      store.set(key, {
        ...current,
        // Keep stale data on screen — a failed background refresh shouldn't
        // blank a page that was working a second ago.
        error: err instanceof Error ? err.message : 'Request failed',
        errorCode: err instanceof ApiError ? err.code : 'UNKNOWN',
        validating: false,
      });
      emit(key);
      return undefined;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request as Promise<T | undefined>;
}

/** Warms a key without subscribing to it. Used for hover/boot prefetching. */
export function prefetch(key: string): void {
  if (hasData(key) || inflight.has(key)) return;
  void revalidate(key);
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Writes data straight into the cache and notifies subscribers.
 * Returns a rollback function that restores the previous entry exactly.
 */
export function mutate<T>(key: string, updater: T | ((current: T | undefined) => T)): () => void {
  const previous = store.get(key);
  const current = previous?.data as T | undefined;
  const next = typeof updater === 'function' ? (updater as (c: T | undefined) => T)(current) : updater;

  store.set(key, {
    data: next,
    error: null,
    errorCode: previous?.errorCode ?? null,
    // Deliberately keeps the old timestamp: an optimistic value is not a
    // network result, so the next revalidate() must not treat it as fresh.
    updatedAt: previous?.updatedAt ?? 0,
    validating: previous?.validating ?? false,
  });
  emit(key);

  return () => {
    if (previous) store.set(key, previous);
    else store.delete(key);
    emit(key);
  };
}

/**
 * Applies the same update to every cached key that starts with `prefix`.
 *
 * The same rows are cached under several keys — `/api/wallets` and
 * `/api/wallets?includeArchived=true` hold overlapping lists — so an optimistic
 * edit has to touch all of them or the Dashboard and the Wallets page disagree.
 */
export function mutateMatching<T>(
  prefix: string,
  updater: (current: T, key: string) => T,
): () => void {
  const rollbacks: (() => void)[] = [];
  for (const key of [...store.keys()]) {
    if (!key.startsWith(prefix)) continue;
    const current = store.get(key)?.data as T | undefined;
    if (current === undefined) continue;
    rollbacks.push(mutate<T>(key, () => updater(current, key)));
  }
  return () => rollbacks.forEach((fn) => fn());
}

/**
 * Marks keys stale and refreshes the ones something is currently showing.
 * Keys nobody is subscribed to are simply dropped so they re-fetch on next use.
 *
 * Resolves once every forced refresh has settled, which is what a manual
 * Refresh button needs in order to stop spinning at the right moment.
 * `revalidate` never rejects, so this never rejects either.
 */
export function refreshPrefixes(prefixes: string[]): Promise<void> {
  const pending: Promise<unknown>[] = [];

  for (const key of [...store.keys()]) {
    if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
    if (refCounts.has(key)) pending.push(revalidate(key, { force: true }));
    else store.delete(key);
  }

  return Promise.all(pending).then(() => undefined);
}

/** Fire-and-forget form of {@link refreshPrefixes}, used after a write lands. */
export function invalidate(prefixes: string[]): void {
  void refreshPrefixes(prefixes);
}

/** Wipes everything — used on sign-out so the next user starts clean. */
export function clearCache(): void {
  const keys = [...store.keys()];
  store.clear();
  inflight.clear();
  keys.forEach(emit);
}

/* ------------------------------------------------------------------ */
/* Focus revalidation                                                  */
/* ------------------------------------------------------------------ */

let lastFocusRevalidate = 0;

function revalidateMounted(): void {
  // Coming back to the tab shouldn't fire a burst of requests.
  if (Date.now() - lastFocusRevalidate < 10_000) return;
  lastFocusRevalidate = Date.now();
  refCounts.forEach((_count, key) => void revalidate(key, { force: true }));
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', revalidateMounted);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revalidateMounted();
  });
}
