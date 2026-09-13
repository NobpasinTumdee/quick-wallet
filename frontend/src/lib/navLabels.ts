import { ROUTES, Route } from './router';
import { TranslationKey } from '../locales';

/**
 * What each screen is called, in one place.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST NAV IN AppShell
 * ---------------------------------------------------------------------------
 * Three surfaces need route → name: the shell's own sidebar and tab bar, the
 * More directory, and the Settings screen where the user rearranges the phone's
 * navigation. The last of those is rendered *by* a page the shell renders, so
 * reaching back into AppShell for the list would be an import cycle.
 *
 * The names live here, keys rather than strings for the usual reason — a
 * module-level table is built once at import, so a translated string in it
 * would be frozen to whichever language was active at boot.
 *
 * ---------------------------------------------------------------------------
 * WHY A Record AND NOT AN ARRAY
 * ---------------------------------------------------------------------------
 * `Record<Route, TranslationKey>` is exhaustive: adding a route to the union
 * without naming it here is a compile error, at the moment the route is added.
 * An array would type-check happily and produce a navigation entry labelled
 * `undefined` on whichever screen happened to render it first.
 */
export const NAV_LABEL_KEYS: Record<Route, TranslationKey> = {
  dashboard: 'nav.dashboard',
  wallets: 'nav.wallets',
  cards: 'nav.cards',
  transactions: 'nav.transactions',
  investments: 'nav.investments',
  analytics: 'nav.analytics',
  goals: 'nav.goals',
  budgets: 'nav.budgets',
  splits: 'nav.splits',
  subscriptions: 'nav.subscriptions',
  debt: 'nav.debt',
  settings: 'nav.settings',
  more: 'nav.more',
  /* Reachable but never navigable — it has no nav entry anywhere. Named so the
     Record stays exhaustive rather than needing an exception. */
  notFound: 'notFound.title',
};

export interface NavLabel {
  route: Route;
  labelKey: TranslationKey;
}

/**
 * Every navigable screen, in route order.
 *
 * Built from `ROUTES`, which excludes `notFound` on purpose: it is somewhere
 * the app can *be* but not somewhere it can be sent, so it must never appear
 * in a picker.
 */
export const NAV_LABELS: readonly NavLabel[] = ROUTES.map((route) => ({
  route,
  labelKey: NAV_LABEL_KEYS[route],
}));
