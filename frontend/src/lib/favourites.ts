import type { SyncedLayoutFormat } from './layout/layoutFormats';
import type { RemotePref } from './layout/layoutSync';

/**
 * Favourites: saved transactions added with one tap.
 *
 * Pure (no React, no requests) so the Node tests load it directly.
 *
 * ---------------------------------------------------------------------------
 * WHERE THEY ARE STORED, AND WHY UNDER A "layout." KEY
 * ---------------------------------------------------------------------------
 * The list syncs through UiPrefs, like the card layouts, so it follows the
 * user across devices without a Code.gs change. The server only accepts keys
 * `layout.<name>` holding `{ v: 1, cards: [...] }` (Code.gs uiPrefsSave_), so
 * the list is stored as `layout.favourites` inside that envelope with an
 * empty `cards`, and says what it is with `kind: "favourites"` and its own
 * `format`. No layout ever reads this key, and every layout reader ignores a
 * value that carries a `kind` (layoutFormats.ts `isForeignPref`), so it can
 * never be taken for a layout. The server caps a value at 20,000 characters.
 */

export const FAVOURITES_PAGE = 'favourites';
export const FAVOURITES_KIND = 'favourites';
export const FAVOURITES_FORMAT_VERSION = 1;

/** Code.gs UI_PREFS_VALUE_MAX_. */
export const PREF_VALUE_MAX = 20000;
/** 40 at the longest every field allows is ~17k characters: always under the cap. */
export const MAX_FAVOURITES = 40;
export const FAV_NAME_MAX = 40;
export const FAV_NOTE_MAX = 120;
export const FAV_GROUP_MAX = 24;
export const FAV_EMOJI_MAX = 8;
/** Same as the transaction form. */
export const FAV_AMOUNT_MAX = 1e12;

export type FavouriteType = 'expense' | 'income' | 'transfer';
/** Theme colour names: each maps to a theme token, so every theme keeps its contrast. */
export const FAV_COLORS = ['accent', 'positive', 'negative', 'warning', 'neutral'] as const;
export type FavouriteColor = (typeof FAV_COLORS)[number];
export type FavouriteStyle = 'auto' | 'chips' | 'tiles' | 'list';
export const FAV_STYLES: readonly FavouriteStyle[] = ['auto', 'chips', 'tiles', 'list'];
export type FavouriteSort = 'manual' | 'usage';

export interface Favourite {
  id: string;
  name: string;
  emoji: string;
  color: FavouriteColor;
  type: FavouriteType;
  /** From, for a transfer. */
  walletId: string;
  /** To, for a transfer; empty otherwise. */
  toWalletId: string;
  /** Empty for a transfer. */
  category: string;
  note: string;
  /** `null`: no amount saved, so a tap asks for one on the number pad. */
  amount: number | null;
  /** Confirm before a one-tap save. */
  ask: boolean;
  /** Hide the amount on the tile. */
  hideAmount: boolean;
  /** Optional section, e.g. "Daily"; empty = none. */
  group: string;
  /** How many times it has been used, and the last day (`YYYY-MM-DD`, or empty). */
  uses: number;
  lastUsed: string;
}

export interface FavouriteList {
  favs: Favourite[];
  /** The card's display; `auto` picks by its size. */
  style: FavouriteStyle;
  sort: FavouriteSort;
  updatedAt: number;
}

export function emptyFavourites(updatedAt = 0): FavouriteList {
  return { favs: [], style: 'auto', sort: 'manual', updatedAt };
}

/* ---- Reading (never throws; anything unusable is dropped) ---- */

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** A wallet id as the app writes them; anything else is not trusted. */
function walletRef(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : '';
}

function amountOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > FAV_AMOUNT_MAX) return null;
  return Math.round(n * 100) / 100;
}

function dayOf(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

/** One stored favourite (compact keys) or a full object, cleaned; `null` when unusable. */
export function sanitizeFavourite(raw: unknown): Favourite | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const pick = (short: string, long: string) => (o[short] !== undefined ? o[short] : o[long]);
  const id = str(o.id, 40);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
  const typeRaw = pick('t', 'type');
  const type: FavouriteType = typeRaw === 'income' || typeRaw === 'transfer' ? typeRaw : 'expense';
  const walletId = walletRef(pick('w', 'walletId'));
  const toWalletId = type === 'transfer' ? walletRef(pick('to', 'toWalletId')) : '';
  const name = str(pick('n', 'name'), FAV_NAME_MAX);
  if (!name) return null;
  const colorRaw = pick('c', 'color');
  const color = (FAV_COLORS as readonly unknown[]).includes(colorRaw) ? (colorRaw as FavouriteColor) : 'accent';
  const usesRaw = Number(pick('u', 'uses'));
  return {
    id,
    name,
    emoji: [...str(pick('e', 'emoji'), 32)].slice(0, 2).join('').slice(0, FAV_EMOJI_MAX),
    color,
    type,
    walletId,
    toWalletId: toWalletId === walletId ? '' : toWalletId,
    category: type === 'transfer' ? '' : str(pick('cat', 'category'), 60),
    note: str(pick('note', 'note'), FAV_NOTE_MAX),
    amount: amountOf(pick('amt', 'amount')),
    ask: pick('ask', 'ask') === 1 || pick('ask', 'ask') === true,
    hideAmount: pick('hide', 'hideAmount') === 1 || pick('hide', 'hideAmount') === true,
    group: str(pick('g', 'group'), FAV_GROUP_MAX),
    uses: Number.isFinite(usesRaw) && usesRaw > 0 ? Math.min(Math.floor(usesRaw), 1e6) : 0,
    lastUsed: dayOf(pick('lu', 'lastUsed')),
  };
}

/** The stored value (string or parsed), cleaned. Anything that is not a favourites value reads as an empty list. */
export function sanitizeFavourites(raw: unknown): FavouriteList {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return emptyFavourites();
    }
  }
  if (!value || typeof value !== 'object') return emptyFavourites();
  const o = value as Record<string, unknown>;
  if (o.kind !== FAVOURITES_KIND || o.format !== FAVOURITES_FORMAT_VERSION) return emptyFavourites();
  const updatedAt = typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) && o.updatedAt > 0 ? o.updatedAt : 0;
  const seen = new Set<string>();
  const favs: Favourite[] = [];
  for (const item of Array.isArray(o.favs) ? o.favs : []) {
    const fav = sanitizeFavourite(item);
    if (!fav || seen.has(fav.id)) continue;
    seen.add(fav.id);
    favs.push(fav);
    if (favs.length >= MAX_FAVOURITES) break;
  }
  const style = (FAV_STYLES as readonly unknown[]).includes(o.style) ? (o.style as FavouriteStyle) : 'auto';
  return { favs, style, sort: o.sort === 'usage' ? 'usage' : 'manual', updatedAt };
}

/* ---- Writing ---- */

function compact(fav: Favourite): Record<string, unknown> {
  const out: Record<string, unknown> = { id: fav.id, n: fav.name, t: fav.type, w: fav.walletId };
  if (fav.emoji) out.e = fav.emoji;
  if (fav.color !== 'accent') out.c = fav.color;
  if (fav.type === 'transfer' && fav.toWalletId) out.to = fav.toWalletId;
  if (fav.type !== 'transfer' && fav.category) out.cat = fav.category;
  if (fav.note) out.note = fav.note;
  if (fav.amount !== null) out.amt = fav.amount;
  if (fav.ask) out.ask = 1;
  if (fav.hideAmount) out.hide = 1;
  if (fav.group) out.g = fav.group;
  if (fav.uses) out.u = fav.uses;
  if (fav.lastUsed) out.lu = fav.lastUsed;
  return out;
}

/** The stored value: the UiPrefs layout envelope (`v`, `cards`) plus what it really is. */
export function serializeFavourites(list: FavouriteList): string {
  return JSON.stringify({
    v: 1,
    cards: [],
    kind: FAVOURITES_KIND,
    format: FAVOURITES_FORMAT_VERSION,
    updatedAt: list.updatedAt,
    style: list.style,
    sort: list.sort,
    favs: list.favs.map(compact),
  });
}

/** Whether a list still fits the server's limit (it always should under MAX_FAVOURITES). */
export function fitsStorage(list: FavouriteList): boolean {
  return serializeFavourites(list).length <= PREF_VALUE_MAX;
}

/** The synced format (useSyncedLayout): `qw.layout.favourites.<user>` here, `layout.favourites` on the server. */
export const FAVOURITES_SYNC_FORMAT: SyncedLayoutFormat<FavouriteList> = {
  page: FAVOURITES_PAGE,
  readLocal: (stored) => sanitizeFavourites(stored[FAVOURITES_PAGE] ?? null),
  fromRemote: (pref: RemotePref) => ({ ...sanitizeFavourites(pref.value), updatedAt: pref.updatedAt }),
  serialize: serializeFavourites,
};

/* ---- Editing (each returns a new list; the stamp is set by the save) ---- */

export function newFavouriteId(random: () => number = Math.random): string {
  let id = 'f_';
  for (let i = 0; i < 8; i += 1) id += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(random() * 32)];
  return id;
}

export type FavouriteDraft = Omit<Favourite, 'id' | 'uses' | 'lastUsed'> & Partial<Pick<Favourite, 'id' | 'uses' | 'lastUsed'>>;

export type EditResult = { ok: true; list: FavouriteList; fav: Favourite } | { ok: false; reason: 'full' | 'invalid' | 'missing' };

/** Adds (no id) or replaces (an id that exists) one favourite, cleaned. */
export function upsertFavourite(list: FavouriteList, draft: FavouriteDraft, makeId = newFavouriteId): EditResult {
  const existing = draft.id ? list.favs.find((fav) => fav.id === draft.id) : undefined;
  if (draft.id && !existing) return { ok: false, reason: 'missing' };
  if (!existing && list.favs.length >= MAX_FAVOURITES) return { ok: false, reason: 'full' };
  let id = existing?.id ?? makeId();
  while (!existing && list.favs.some((fav) => fav.id === id)) id = makeId();
  const fav = sanitizeFavourite({
    ...draft,
    id,
    uses: existing?.uses ?? draft.uses ?? 0,
    lastUsed: existing?.lastUsed ?? draft.lastUsed ?? '',
  });
  if (!fav) return { ok: false, reason: 'invalid' };
  const favs = existing ? list.favs.map((item) => (item.id === id ? fav : item)) : [...list.favs, fav];
  const next = { ...list, favs };
  if (!fitsStorage(next)) return { ok: false, reason: 'full' };
  return { ok: true, list: next, fav };
}

export function removeFavourite(list: FavouriteList, id: string): FavouriteList {
  return { ...list, favs: list.favs.filter((fav) => fav.id !== id) };
}

/** A copy right after the original, "Coffee (copy)", usage reset. */
export function duplicateFavourite(list: FavouriteList, id: string, copySuffix: string, makeId = newFavouriteId): EditResult {
  const at = list.favs.findIndex((fav) => fav.id === id);
  if (at < 0) return { ok: false, reason: 'missing' };
  if (list.favs.length >= MAX_FAVOURITES) return { ok: false, reason: 'full' };
  let newId = makeId();
  while (list.favs.some((fav) => fav.id === newId)) newId = makeId();
  const source = list.favs[at];
  const name = `${source.name.slice(0, FAV_NAME_MAX - copySuffix.length - 1)} ${copySuffix}`.trim();
  const fav: Favourite = { ...source, id: newId, name, uses: 0, lastUsed: '' };
  const favs = [...list.favs.slice(0, at + 1), fav, ...list.favs.slice(at + 1)];
  const next = { ...list, favs };
  if (!fitsStorage(next)) return { ok: false, reason: 'full' };
  return { ok: true, list: next, fav };
}

/** Moves one favourite by `delta` places (manual order); unchanged at the ends. */
export function moveFavourite(list: FavouriteList, id: string, delta: number): FavouriteList {
  const from = list.favs.findIndex((fav) => fav.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.favs.length || delta === 0) return list;
  const favs = [...list.favs];
  const [item] = favs.splice(from, 1);
  favs.splice(to, 0, item);
  return { ...list, favs };
}

/** Puts one favourite at an index (drag and drop). */
export function placeFavourite(list: FavouriteList, id: string, index: number): FavouriteList {
  const from = list.favs.findIndex((fav) => fav.id === id);
  if (from < 0) return list;
  return moveFavourite(list, id, Math.max(0, Math.min(list.favs.length - 1, index)) - from);
}

/** Adds counted uses (batched) to the favourites that still exist. */
export function applyUsage(list: FavouriteList, counts: ReadonlyMap<string, { uses: number; day: string }>): FavouriteList {
  if (counts.size === 0) return list;
  let changed = false;
  const favs = list.favs.map((fav) => {
    const add = counts.get(fav.id);
    if (!add) return fav;
    changed = true;
    return { ...fav, uses: Math.min(fav.uses + add.uses, 1e6), lastUsed: add.day > fav.lastUsed ? add.day : fav.lastUsed };
  });
  return changed ? { ...list, favs } : list;
}

/* ---- Reading for display ---- */

/** In display order: manual, or most used first (ties: most recent, then manual order). */
export function orderedFavourites(list: FavouriteList): Favourite[] {
  if (list.sort !== 'usage') return list.favs;
  const index = new Map(list.favs.map((fav, i) => [fav.id, i]));
  return [...list.favs].sort(
    (a, b) => b.uses - a.uses || b.lastUsed.localeCompare(a.lastUsed) || index.get(a.id)! - index.get(b.id)!,
  );
}

/** Sections in first-appearance order; favourites without a group come first, under "". */
export function groupFavourites(favs: readonly Favourite[]): { group: string; favs: Favourite[] }[] {
  const groups = new Map<string, Favourite[]>();
  for (const fav of favs) {
    const items = groups.get(fav.group);
    if (items) items.push(fav);
    else groups.set(fav.group, [fav]);
  }
  const out = [...groups.entries()].map(([group, items]) => ({ group, favs: items }));
  return out.sort((a, b) => (a.group === '' ? -1 : b.group === '' ? 1 : 0));
}

/** The groups already used, for the editor's suggestions. */
export function favouriteGroups(list: FavouriteList): string[] {
  return [...new Set(list.favs.map((fav) => fav.group).filter(Boolean))];
}

/** The card's display for its size, when the style is `auto`. */
export function autoStyle(width: number, height: number): Exclude<FavouriteStyle, 'auto'> {
  if (height > 0 && height < 150) return 'chips';
  if (width >= 260 && height >= 420) return 'list';
  return 'tiles';
}

/* ---- Using one ---- */

export interface FavouritePayload {
  walletId: string;
  toWalletId: string;
  type: FavouriteType;
  amount: number;
  category: string;
  note: string;
  date: string;
}

/** The transaction a favourite adds: the same shape the New transaction form sends. */
export function favouritePayload(fav: Favourite, amount: number, today: string): FavouritePayload {
  return {
    walletId: fav.walletId,
    toWalletId: fav.type === 'transfer' ? fav.toWalletId : '',
    type: fav.type,
    amount,
    category: fav.type === 'transfer' ? '' : fav.category,
    note: fav.note,
    date: today,
  };
}

/**
 * What stops a favourite from being used as saved: a wallet that was deleted
 * or archived, a transfer without a destination, an expense without a category.
 * The tap then opens the full form, filled in, instead of guessing.
 */
export function favouriteProblem(
  fav: Favourite,
  wallets: readonly { id: string; archived?: boolean; mode?: string }[],
): 'wallet' | 'to' | 'category' | null {
  const from = wallets.find((wallet) => wallet.id === fav.walletId && !wallet.archived);
  if (!from) return 'wallet';
  if (fav.type !== 'transfer' && from.mode === 'investment') return 'wallet';
  if (fav.type === 'transfer') {
    if (!wallets.some((wallet) => wallet.id === fav.toWalletId && !wallet.archived)) return 'to';
    return null;
  }
  return fav.category ? null : 'category';
}

/** A draft from a transaction (Activity's "Make favourite", the form's "Save as favourite"). */
export function draftFromTransaction(tx: {
  type: FavouriteType;
  walletId: string;
  toWalletId?: string;
  category?: string;
  note?: string;
  amount?: number | null;
}): FavouriteDraft {
  const note = (tx.note ?? '').trim();
  const name = (tx.type === 'transfer' ? note : note || tx.category || '').slice(0, FAV_NAME_MAX);
  return {
    name,
    emoji: '',
    color: tx.type === 'income' ? 'positive' : tx.type === 'transfer' ? 'neutral' : 'accent',
    type: tx.type,
    walletId: tx.walletId,
    toWalletId: tx.type === 'transfer' ? (tx.toWalletId ?? '') : '',
    category: tx.type === 'transfer' ? '' : (tx.category ?? ''),
    note: note.slice(0, FAV_NOTE_MAX),
    amount: amountOf(tx.amount),
    ask: false,
    hideAmount: false,
    group: '',
  };
}

/* ---- Deep link: ?fav=<id> (opens it, never saves) ---- */

export function parseFavLink(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const id = (params.get('fav') ?? '').trim();
  return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : null;
}
