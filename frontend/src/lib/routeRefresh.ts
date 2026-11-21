import type { Route } from './router';

/**
 * Screens whose data lives outside the request cache (`api/cache.ts`) tell
 * the topbar's Refresh how to reload it. Planning keeps its own store (see
 * lib/planning/store.ts) and is lazy-loaded, so the shell cannot import it;
 * the page registers here while it is mounted instead.
 */
const refreshers = new Map<Route, () => Promise<unknown>>();

export function setRouteRefresher(route: Route, refresh: () => Promise<unknown>): () => void {
  refreshers.set(route, refresh);
  return () => {
    if (refreshers.get(route) === refresh) refreshers.delete(route);
  };
}

export function runRouteRefresher(route: Route): Promise<unknown> {
  return refreshers.get(route)?.() ?? Promise.resolve();
}
