import { ROUTES, Route } from './router';

/**
 * Which screens the phone's two navigation surfaces carry.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A RESOLVER AND NOT JUST A TYPE
 * ---------------------------------------------------------------------------
 * The stored config is user data that outlives the code that wrote it. A route
 * gets renamed, a page is retired, someone edits the sheet cell by hand, or a
 * config written by a newer build is read by an older one. Every one of those
 * produces a layout referencing screens that do not exist — and the failure
 * mode is not an error, it is a tab bar with a dead button on it.
 *
 * So nothing reads `settings.mobileNavConfig` directly. It goes through
 * `resolveMobileNav`, which drops what it does not recognise, fills the gaps
 * from the defaults, and returns a layout that is correct by construction.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THAT IS NOT A PREFERENCE
 * ---------------------------------------------------------------------------
 * `more` must survive. It is the only surface that reaches every screen, so a
 * layout without it can strand a route with no way to open it on a phone —
 * silently, because everything still renders. A user who fills all nine slots
 * with other pages gets `more` put back in the last arc slot regardless. That
 * is the one choice this module overrides, and it is the difference between a
 * customisable layout and a broken one.
 */

/** Two links, the centre button, two links. Four is what fits at 320px. */
export const TAB_SLOTS = 4;

/**
 * Five is a geometric ceiling, not a preference: at six the arc items overlap
 * on a 320px screen. See `arcRadius` in GestureNavWidget.
 */
export const ARC_SLOTS = 5;

export interface MobileNavConfig {
  /** Bottom bar, left to right. Always exactly `TAB_SLOTS` long. */
  tabs: Route[];
  /** Gesture arc, left to right. Up to `ARC_SLOTS`, always contains `more`. */
  arc: Route[];
}

/**
 * The layout everyone gets until they change it.
 *
 * The tabs are the screens opened to *read* something several times a day; the
 * arc holds the ones opened to *change* something, plus the directory.
 */
export const DEFAULT_MOBILE_NAV: MobileNavConfig = {
  tabs: ['dashboard', 'transactions', 'investments', 'wallets'],
  arc: ['subscriptions', 'budgets', 'cards', 'splits', 'more'],
};

/** Every route a user may put in a slot. */
export const ASSIGNABLE_ROUTES: readonly Route[] = ROUTES;

function isRoute(value: unknown): value is Route {
  return typeof value === 'string' && (ROUTES as readonly string[]).includes(value);
}

/** Known routes only, in order, with duplicates removed. */
function clean(list: unknown, seen: Set<Route>): Route[] {
  if (!Array.isArray(list)) return [];
  const out: Route[] = [];
  for (const entry of list) {
    if (!isRoute(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

/**
 * A stored config, repaired into one that is safe to render.
 *
 * Accepts `unknown` on purpose: the value comes back from a spreadsheet cell
 * through `JSON.parse`, so its type at the boundary is a claim, not a fact.
 */
export function resolveMobileNav(raw: unknown): MobileNavConfig {
  const config = (raw ?? {}) as Partial<Record<'tabs' | 'arc', unknown>>;

  /* Shared across both lists: a route in the bar *and* the arc is one wasted
     slot and two identical-looking buttons. First mention wins. */
  const seen = new Set<Route>();
  const tabs = clean(config.tabs, seen).slice(0, TAB_SLOTS);
  const arc = clean(config.arc, seen).slice(0, ARC_SLOTS);

  /**
   * Nothing recognisable at all means "unset", and unset means the stock
   * layout — a fresh profile, a null cell, junk from a hand-edited sheet.
   *
   * The emptiness has to be judged across *both* surfaces, and only here at the
   * top. Backfilling a short arc the way the bar is backfilled would make
   * `removeArcSlot` impossible: the slot would come straight back on the next
   * resolve, and the button would look broken. So a config with even one
   * recognised route is taken as deliberate, and the arc is left the length the
   * user made it.
   *
   * The bar is different, and padded below whatever happens: its CSS lays out
   * two cells, the centre button, two cells, so a missing tab is a visible hole
   * rather than a shorter bar.
   */
  if (tabs.length === 0 && arc.length === 0) {
    return { tabs: [...DEFAULT_MOBILE_NAV.tabs], arc: [...DEFAULT_MOBILE_NAV.arc] };
  }

  /* Backfill the bar from the defaults. A short bar is not a cosmetic problem:
     the CSS lays it out as two cells, the centre button, two cells, so three
     tabs leave a visible hole where the fourth should be. */
  for (const route of DEFAULT_MOBILE_NAV.tabs) {
    if (tabs.length >= TAB_SLOTS) break;
    if (seen.has(route)) continue;
    seen.add(route);
    tabs.push(route);
  }
  /* Still short only if the defaults themselves were consumed by the arc.
     Anything not already placed will do — a filled slot beats a gap. */
  for (const route of ROUTES) {
    if (tabs.length >= TAB_SLOTS) break;
    if (seen.has(route)) continue;
    seen.add(route);
    tabs.push(route);
  }

  /* The escape hatch. Appended if there is room, otherwise it takes the last
     arc slot — the one furthest from the thumb's rest position, so the cost
     lands on the least-reachable of the user's own choices. */
  if (!tabs.includes('more') && !arc.includes('more')) {
    if (arc.length < ARC_SLOTS) arc.push('more');
    else arc[arc.length - 1] = 'more';
  }

  return { tabs, arc };
}

/** True when this layout is the stock one — lets the UI hide a "reset" action. */
export function isDefaultMobileNav(config: MobileNavConfig): boolean {
  const same = (a: Route[], b: Route[]) =>
    a.length === b.length && a.every((route, index) => route === b[index]);
  return (
    same(config.tabs, DEFAULT_MOBILE_NAV.tabs) && same(config.arc, DEFAULT_MOBILE_NAV.arc)
  );
}

/**
 * Move a route between slots without ever producing a duplicate.
 *
 * The Settings UI is a grid of dropdowns, and the obvious implementation — set
 * slot 2 to Goals — puts Goals in two places the moment it was already in slot
 * 5. Swapping instead means every edit is a permutation: the set of chosen
 * routes changes only when the user picks something genuinely new, and no edit
 * can silently drop a screen off the phone.
 */
export function assignSlot(
  config: MobileNavConfig,
  surface: 'tabs' | 'arc',
  index: number,
  route: Route,
): MobileNavConfig {
  const next: MobileNavConfig = { tabs: [...config.tabs], arc: [...config.arc] };
  const displaced = next[surface][index];
  if (displaced === route) return config;

  /* Wherever the incoming route currently lives, it gives up that slot to the
     route being displaced — so the two trade places rather than one vanishing. */
  for (const key of ['tabs', 'arc'] as const) {
    const at = next[key].indexOf(route);
    if (at !== -1) next[key][at] = displaced;
  }

  next[surface][index] = route;
  return resolveMobileNav(next);
}

/** Drop one arc slot. The bar has a fixed shape, so only the arc can shrink. */
export function removeArcSlot(config: MobileNavConfig, index: number): MobileNavConfig {
  const arc = config.arc.filter((_, at) => at !== index);
  return resolveMobileNav({ tabs: config.tabs, arc });
}

/** Add a route to the arc, if there is room and it is not already placed. */
export function addArcSlot(config: MobileNavConfig, route: Route): MobileNavConfig {
  if (config.arc.length >= ARC_SLOTS) return config;
  if (config.tabs.includes(route) || config.arc.includes(route)) return config;
  return resolveMobileNav({ tabs: config.tabs, arc: [...config.arc, route] });
}

/* ------------------------------------------------------------------ */
/* Paydays                                                             */
/* ------------------------------------------------------------------ */

/** Weekly is five in a long month; more than eight is not a salary. */
export const MAX_PAYDAYS = 8;

/**
 * Stored paydays, repaired.
 *
 * Sorted and deduped so the heatmap draws its gold rules in calendar order and
 * never twice on one cell. Day 29-31 is kept rather than clamped: it is a
 * legitimate choice, and the month that has no 31st simply shows no marker,
 * which is the truth.
 */
export function resolvePaydays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const entry of raw) {
    const day = Math.round(Number(entry));
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;
    seen.add(day);
  }
  return [...seen].sort((a, b) => a - b).slice(0, MAX_PAYDAYS);
}
