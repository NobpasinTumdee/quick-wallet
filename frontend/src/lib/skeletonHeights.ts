/**
 * How tall each card was the last time it loaded on this screen, so its
 * skeleton can take the same room next time and nothing moves when the data
 * lands. Only where the height is the content's own: a placed desktop layout
 * already fixes every card's height in rows.
 *
 * Per device and per user (`qw.skh.<userId>`): another account's heights are
 * removed on the first write, and never read. Small and capped — a handful
 * of screens, a few dozen numbers — and every access survives blocked or
 * full storage, where skeletons fall back to their shapes' own height.
 */

const PREFIX = 'qw.skh.';
const MAX_SCOPES = 40;
const MAX_IDS = 24;
const MAX_CHARS = 4000;
const MAX_PX = 4000;

type Store = { v: 1; s: Record<string, Record<string, number>> };

let cache: { user: string; store: Store } | null = null;

function load(user: string): Store {
  if (cache?.user === user) return cache.store;
  let store: Store = { v: 1, s: {} };
  try {
    const raw = window.localStorage.getItem(PREFIX + user);
    const parsed = raw ? (JSON.parse(raw) as Partial<Store>) : null;
    if (parsed && parsed.v === 1 && parsed.s && typeof parsed.s === 'object') store = { v: 1, s: parsed.s };
  } catch {
    /* Unreadable: start empty. */
  }
  cache = { user, store };
  return store;
}

/**
 * The screen a height belongs to: the page and the width band its layout
 * changes at (phone in either mobile layout, tablet, desktop).
 */
export function heightScope(page: string, width: number, mobileV2: boolean): string {
  const band = width < 768 ? (mobileV2 ? 'pn' : 'pc') : width < 1000 ? 't' : 'd';
  return `${page}:${band}`;
}

export function rememberedHeight(user: string | undefined, scope: string, id: string): number | undefined {
  if (!user) return undefined;
  const value = load(user).s[scope]?.[id];
  return typeof value === 'number' && value > 0 && value <= MAX_PX ? value : undefined;
}

/** Saves the heights drawn for a screen (only when one changed by half a pixel or more). */
export function rememberHeights(user: string | undefined, scope: string, heights: Record<string, number>): void {
  if (!user) return;
  const store = load(user);
  const before = store.s[scope] ?? {};
  const next: Record<string, number> = {};
  let changed = false;
  for (const [id, raw] of Object.entries(heights).slice(0, MAX_IDS)) {
    /* To a tenth of a pixel: whole pixels leave the page 1px off. */
    const h = Math.round(raw * 10) / 10;
    if (!(h > 0 && h <= MAX_PX)) continue;
    next[id] = h;
    if (Math.abs((before[id] ?? 0) - h) >= 0.5) changed = true;
  }
  if (!changed && Object.keys(next).length === Object.keys(before).length) return;
  /* Newest screen last; the oldest goes first when over the cap. */
  const { [scope]: _old, ...others } = store.s;
  const scopes = Object.entries({ ...others, [scope]: next }).slice(-MAX_SCOPES);
  store.s = Object.fromEntries(scopes);
  try {
    let text = JSON.stringify(store);
    while (text.length > MAX_CHARS && Object.keys(store.s).length > 1) {
      delete store.s[Object.keys(store.s)[0]];
      text = JSON.stringify(store);
    }
    /* One account's heights at a time: another user's are dropped. */
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PREFIX) && key !== PREFIX + user) window.localStorage.removeItem(key);
    }
    window.localStorage.setItem(PREFIX + user, text);
  } catch {
    /* Not stored; this session still uses the copy in memory. */
  }
}
