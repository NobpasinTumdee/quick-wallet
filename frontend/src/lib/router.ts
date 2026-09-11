import { useEffect, useState } from 'react';

/**
 * Minimal hash router. Hash routing means the app works when opened straight
 * from `dist/index.html`, with no server-side rewrite rules — which matters for
 * something that only ever runs locally.
 */

export const ROUTES = [
  'dashboard',
  'wallets',
  'cards',
  'transactions',
  'investments',
  'budgets',
  'splits',
  'subscriptions',
  'settings',
] as const;
export type Route = (typeof ROUTES)[number];

const DEFAULT_ROUTE: Route = 'dashboard';

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim();
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : DEFAULT_ROUTE;
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
