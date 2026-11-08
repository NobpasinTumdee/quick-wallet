import { useEffect, useState, useSyncExternalStore } from 'react';
import { takeSoftHistoryEntry } from './overlayStack';

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
  'debt',
  'settings',
  /* The app directory. Not a feature screen — a way *to* the feature screens,
     for the phone, where the sidebar does not exist and the gesture arc holds
     five items at most. See MoreMenuPage. */
  'more',
  /* A mode of Analytics with its own address, so it can be bookmarked, linked
     and reached with the back button. Hyphenated because the hash is the URL a
     person sees; every consumer treats it as an opaque id. */
  'deep-analytics',
  /* Long-form notes. Last on purpose: `resolveMobileNav` backfills a short tab
     bar from this list in order, and a new screen must not change anyone's
     phone layout by appearing early in it. */
  'notes',
  /* Home-screen widget tokens and setup, reached from Settings and More.
     After notes for the same reason notes is last. */
  'widgets',
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
/**
 * Pages that can be linked to but are never listed: not in the sidebar, the
 * More menu, the tab-bar choices or its backfill (all built from ROUTES).
 * The month review is reached from its banner, the month pill and Analytics,
 * and carries its month in the hash: #/review?period=YYYY-MM.
 */
export const HIDDEN_ROUTES = ['review'] as const;

export type Route = (typeof ROUTES)[number] | (typeof HIDDEN_ROUTES)[number] | 'notFound';

const DEFAULT_ROUTE: Route = 'dashboard';

function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value) || (HIDDEN_ROUTES as readonly string[]).includes(value);
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

/* When the app itself last asked for a page (a tap on the nav, a link in a
   card). Back, forward, the Android back button and the iOS swipe never come
   through here, which is how the page entry tells them apart and stays still. */
let lastNavigateAt = -Infinity;

export function lastNavigationAt(): number {
  return lastNavigateAt;
}

export function navigate(route: Route): void {
  if (parseHash() === route) return;
  lastNavigateAt = performance.now();
  /* Leaving a page while its selection holds the current history step:
     replace that step rather than stack the new page on top of it, or Back
     would land on the old page's leftover step first. */
  if (takeSoftHistoryEntry()) {
    window.location.replace(`#/${route}`);
    return;
  }
  window.location.hash = `#/${route}`;
}

/** One value from the hash's query (`#/review?period=2026-10` → `period`). */
export function hashParam(name: string, hash: string = window.location.hash): string | null {
  const query = hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get(name);
}

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** `hashParam`, kept current as the hash changes (the route alone does not re-render on a new query). */
export function useHashParam(name: string): string | null {
  return useSyncExternalStore(subscribeHash, () => hashParam(name), () => null);
}

/** Opens the review of `period` (YYYY-MM). */
export function openReview(period: string): void {
  const target = `#/review?period=${encodeURIComponent(period)}`;
  if (window.location.hash === target) return;
  lastNavigateAt = performance.now();
  if (takeSoftHistoryEntry()) {
    window.location.replace(target);
    return;
  }
  window.location.hash = target;
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
