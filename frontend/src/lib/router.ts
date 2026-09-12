import { useEffect, useState } from 'react';

/**
 * Minimal hash router. Hash routing means the app works when opened straight
 * from `dist/index.html`, with no server-side rewrite rules — which matters for
 * something that only ever runs locally.
 */

/** Every route that can be navigated to. Order is not meaningful. */
export const ROUTES = [
  'dashboard',
  'wallets',
  'cards',
  'transactions',
  'investments',
  'analytics',
  'goals',
  'budgets',
  'splits',
  'subscriptions',
  'settings',
] as const;

/**
 * `notFound` is deliberately outside `ROUTES`.
 *
 * It is somewhere the app can *be*, but not somewhere it can be sent: nothing
 * links to it, it has no nav entry, and `navigate('notFound')` is not a
 * meaningful thing to write. Keeping it out of the array is what stops it
 * appearing in any list built from `ROUTES`, while the union below still forces
 * every `Record<Route, …>` — the prefetch and refresh maps in AppShell — to say
 * what it does on that screen.
 */
export type Route = (typeof ROUTES)[number] | 'notFound';

const DEFAULT_ROUTE: Route = 'dashboard';

function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

/**
 * Reads the hash.
 *
 * An unrecognised hash resolves to `notFound` rather than silently falling back
 * to the dashboard. The old behaviour meant a mistyped or renamed link showed
 * the Overview screen as though nothing had happened, which is indistinguishable
 * from the link having worked — the user reads today's balances and never learns
 * the page they wanted is gone.
 *
 * An *empty* hash is different, and still means the dashboard: that is someone
 * opening the app, not someone following a broken link.
 */
function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim();
  if (!raw) return DEFAULT_ROUTE;
  return isRoute(raw) ? raw : 'notFound';
}

/** The hash as typed, for the 404 screen to quote back. */
export function currentHashPath(): string {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim();
  return raw ? `#/${raw}` : '#/';
}

export function navigate(route: Route): void {
  if (parseHash() === route) return;
  window.location.hash = `#/${route}`;
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) window.location.hash = `#/${DEFAULT_ROUTE}`;
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return [route, navigate];
}
