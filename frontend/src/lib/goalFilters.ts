import { Goal, Transaction } from '../types';
import { goalPace, readyToBuy, ringPercent } from './goalMath';

/**
 * Filtering, sorting and the spending summary for the Goals screen.
 *
 * Pure on purpose: no React, no cache, no `Date.now()` that is not passed in.
 * `useGoalFilters` owns the state and the URL; this file only answers "given
 * these goals and these filters, what is on screen and what does it add up
 * to".
 *
 * ---------------------------------------------------------------------------
 * WHERE "SPENT" COMES FROM
 * ---------------------------------------------------------------------------
 * The Goals sheet does not store what a purchase cost. `goals.purchase` writes
 * an expense and keeps its id in `purchaseTxId`, so the amount, the wallet and
 * the category all live on that Transaction row. The client joins the two.
 *
 * When the row cannot be found — deleted from Activity, or outside what was
 * fetched — the goal's own `targetAmount` stands in, which is what the server
 * charged at the time unless the goal was edited afterwards. That figure is
 * flagged `estimated` all the way to the screen, so a total that contains a
 * guess always says so.
 */

/* ------------------------------------------------------------------ */
/* Filter state                                                         */
/* ------------------------------------------------------------------ */

/** The four states a goal can be seen in. `overdue` overlaps `saving`. */
export const GOAL_STATUS_FILTERS = ['saving', 'ready', 'purchased', 'overdue'] as const;
export type GoalStatusFilter = (typeof GOAL_STATUS_FILTERS)[number];

export const GOAL_DATE_FIELDS = ['created', 'deadline', 'completed'] as const;
export type GoalDateField = (typeof GOAL_DATE_FIELDS)[number];

export const GOAL_DATE_PRESETS = ['all', 'thisMonth', 'last3', 'thisYear', 'lastYear', 'custom'] as const;
export type GoalDatePreset = (typeof GOAL_DATE_PRESETS)[number];

export const GOAL_PROGRESS_BANDS = ['0-25', '25-50', '50-75', '75-99', '100'] as const;
export type GoalProgressBand = (typeof GOAL_PROGRESS_BANDS)[number];

/**
 * `auto` is the screen's own order: active goals by deadline, completed ones
 * newest first. Every other key applies the same way to both sections.
 */
export const GOAL_SORT_KEYS = ['auto', 'deadline', 'created', 'completed', 'target', 'spent', 'progress', 'name'] as const;
export type GoalSortKey = (typeof GOAL_SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';

export interface GoalFilters {
  search: string;
  statuses: GoalStatusFilter[];
  dateField: GoalDateField;
  datePreset: GoalDatePreset;
  /** `YYYY-MM-DD`, only read while `datePreset === 'custom'`. */
  from: string;
  to: string;
  /** Raw strings, like every other amount field in the app: a half-typed decimal survives. */
  minTarget: string;
  maxTarget: string;
  minSpent: string;
  maxSpent: string;
  progress: GoalProgressBand[];
  /** Purchased goals only — the wallet is on the purchase expense. */
  walletIds: string[];
  /** Purchased goals only — the category is on the purchase expense. */
  categories: string[];
  sort: GoalSortKey;
  dir: SortDirection;
}

export const DEFAULT_GOAL_FILTERS: GoalFilters = {
  search: '',
  statuses: [],
  dateField: 'deadline',
  datePreset: 'all',
  from: '',
  to: '',
  minTarget: '',
  maxTarget: '',
  minSpent: '',
  maxSpent: '',
  progress: [],
  walletIds: [],
  categories: [],
  sort: 'auto',
  dir: 'asc',
};

/* ------------------------------------------------------------------ */
/* Rows                                                                 */
/* ------------------------------------------------------------------ */

export interface GoalSpend {
  amount: number;
  /** Empty when the purchase expense was not found. */
  walletId: string;
  category: string;
  /** `YYYY-MM-DD` the goal was bought on. */
  date: string;
  /** True when `amount` is the goal's target standing in for a missing expense. */
  estimated: boolean;
}

/** A goal plus everything the filters and the summary read off it. */
export interface GoalRow {
  goal: Goal;
  /** Null on a goal that has not been bought. */
  spend: GoalSpend | null;
  /** 0…100, clamped — what the bar shows. */
  progress: number;
  ready: boolean;
  overdue: boolean;
  /** `YYYY-MM-DD` in local time, from the `createdAt` timestamp. */
  createdKey: string;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A stored timestamp as the local calendar day it happened on. */
function localKey(iso: string): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : toDateKey(date);
}

/**
 * What a purchased goal cost, from its expense when it can be found.
 *
 * The expense's own amount wins over `targetAmount`: if the user corrected the
 * price on Activity afterwards, that correction is what left the wallet.
 */
export function goalSpend(goal: Goal, txById: ReadonlyMap<string, Transaction>): GoalSpend | null {
  if (!goal.purchased) return null;
  const tx = goal.purchaseTxId ? txById.get(goal.purchaseTxId) : undefined;
  if (tx) {
    return {
      amount: round2(Number(tx.amount) || 0),
      walletId: tx.walletId,
      category: tx.category,
      date: goal.purchasedAt || tx.date,
      estimated: false,
    };
  }
  return {
    amount: round2(Number(goal.targetAmount) || 0),
    walletId: '',
    category: '',
    date: goal.purchasedAt,
    estimated: true,
  };
}

export function buildGoalRows(
  goals: Goal[],
  txById: ReadonlyMap<string, Transaction>,
  today = new Date(),
): GoalRow[] {
  return goals.map((goal) => ({
    goal,
    spend: goalSpend(goal, txById),
    progress: goal.purchased ? 100 : ringPercent(goal),
    ready: readyToBuy(goal),
    overdue: !goal.purchased && goalPace(goal, today).overdue,
    createdKey: localKey(goal.createdAt),
  }));
}

/**
 * The `from`…`to` span the purchase expenses can fall in.
 *
 * The expense is booked on `purchasedAt`, so fetching exactly that window is
 * enough to find every one of them — far cheaper than the whole ledger, and
 * not capped at the 500 most recent rows the default list returns.
 */
export function purchaseWindow(goals: Goal[]): { from: string; to: string } | null {
  const dates = goals
    .filter((goal) => goal.purchased && goal.purchasedAt)
    .map((goal) => goal.purchasedAt)
    .sort();
  if (!dates.length) return null;
  return { from: dates[0], to: dates[dates.length - 1] };
}

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

/**
 * Whole calendar days from today to a `YYYY-MM-DD`, negative once it has
 * passed, or null for no date. Counted between local midnights, so a
 * deadline tomorrow is 1 at 23:59 and at 00:01 alike.
 */
export function daysUntil(dateKey: string, today = new Date()): number | null {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return null;
  const due = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - now) / 86_400_000);
}

/** The inclusive `YYYY-MM-DD` bounds a preset stands for, or null for no bound. */
export function goalPresetRange(
  filters: Pick<GoalFilters, 'datePreset' | 'from' | 'to'>,
  today = new Date(),
): { from: string; to: string } | null {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (filters.datePreset) {
    case 'all':
      return null;
    case 'thisMonth':
      return { from: toDateKey(new Date(y, m, 1)), to: toDateKey(new Date(y, m + 1, 0)) };
    case 'last3':
      /* This month and the two before it — "the last three months" as a
         person reads a calendar, not 90 days back from today. */
      return { from: toDateKey(new Date(y, m - 2, 1)), to: toDateKey(new Date(y, m + 1, 0)) };
    case 'thisYear':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'custom':
      if (!filters.from && !filters.to) return null;
      return { from: filters.from, to: filters.to };
  }
}

function dateFor(row: GoalRow, field: GoalDateField): string {
  if (field === 'created') return row.createdKey;
  if (field === 'deadline') return row.goal.deadline;
  return row.goal.purchased ? row.goal.purchasedAt : '';
}

/* ------------------------------------------------------------------ */
/* Text                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Thai-safe, case-insensitive matching.
 *
 * NFC first: the same Thai syllable can be typed with its vowel and tone mark
 * in either order on some keyboards, and composing both sides makes them
 * compare equal. Thai has no case, so lowercasing only ever touches the Latin
 * part of a mixed title.
 */
export function normaliseText(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* Filtering                                                            */
/* ------------------------------------------------------------------ */

function parseAmount(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function inRange(value: number, min: number | null, max: number | null): boolean {
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

function inBand(progress: number, band: GoalProgressBand): boolean {
  switch (band) {
    case '0-25':
      return progress < 25;
    case '25-50':
      return progress >= 25 && progress < 50;
    case '50-75':
      return progress >= 50 && progress < 75;
    case '75-99':
      return progress >= 75 && progress < 100;
    case '100':
      return progress >= 100;
  }
}

function matchesStatus(row: GoalRow, status: GoalStatusFilter): boolean {
  switch (status) {
    case 'saving':
      return !row.goal.purchased && !row.ready;
    case 'ready':
      return row.ready;
    case 'purchased':
      return row.goal.purchased;
    case 'overdue':
      return row.overdue;
  }
}

/** True when the row survives every filter except the sort. */
export function matchesGoalFilters(row: GoalRow, filters: GoalFilters, today = new Date()): boolean {
  const { goal } = row;

  /* Statuses are alternatives: "Ready or Overdue" is the useful reading. */
  if (filters.statuses.length && !filters.statuses.some((status) => matchesStatus(row, status))) {
    return false;
  }

  const range = goalPresetRange(filters, today);
  if (range) {
    const key = dateFor(row, filters.dateField);
    /* A goal with no date in the chosen field is not in any range — a goal
       with no deadline did not fall due "this month". */
    if (!key) return false;
    if (range.from && key < range.from) return false;
    if (range.to && key > range.to) return false;
  }

  if (!inRange(Number(goal.targetAmount) || 0, parseAmount(filters.minTarget), parseAmount(filters.maxTarget))) {
    return false;
  }

  const minSpent = parseAmount(filters.minSpent);
  const maxSpent = parseAmount(filters.maxSpent);
  if (minSpent !== null || maxSpent !== null) {
    if (!row.spend || !inRange(row.spend.amount, minSpent, maxSpent)) return false;
  }

  if (filters.progress.length && !filters.progress.some((band) => inBand(row.progress, band))) {
    return false;
  }

  /* Only a purchase has a wallet and a category, so either filter narrows the
     list to bought goals. The panel says so beside the controls. */
  if (filters.walletIds.length && !(row.spend && filters.walletIds.includes(row.spend.walletId))) {
    return false;
  }
  if (filters.categories.length && !(row.spend && filters.categories.includes(row.spend.category))) {
    return false;
  }

  const needle = normaliseText(filters.search);
  if (needle && !normaliseText(`${goal.title} ${goal.note}`).includes(needle)) return false;

  return true;
}

/* ------------------------------------------------------------------ */
/* Sorting                                                              */
/* ------------------------------------------------------------------ */

/**
 * Missing values sort last in either direction — a goal with no deadline is
 * never the "most urgent" one just because the list was flipped.
 */
function compareOptional<T>(a: T | null, b: T | null, compare: (x: T, y: T) => number, dir: SortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const result = compare(a, b);
  return dir === 'asc' ? result : -result;
}

const byString = (x: string, y: string) => x.localeCompare(y);
const byNumber = (x: number, y: number) => x - y;

function sortValue(row: GoalRow, key: Exclude<GoalSortKey, 'auto'>): string | number | null {
  switch (key) {
    case 'deadline':
      return row.goal.deadline || null;
    case 'created':
      return row.createdKey || row.goal.createdAt || null;
    case 'completed':
      return row.goal.purchased ? row.goal.purchasedAt || null : null;
    case 'target':
      return Number(row.goal.targetAmount) || 0;
    case 'spent':
      return row.spend ? row.spend.amount : null;
    case 'progress':
      return row.progress;
    case 'name':
      return row.goal.title;
  }
}

export function compareGoalRows(a: GoalRow, b: GoalRow, sort: GoalSortKey, dir: SortDirection, locale?: string): number {
  if (sort === 'auto') {
    /* Bought goals: newest purchase first. Active ones: soonest deadline
       first, undated last — the order the server already returns. */
    if (a.goal.purchased && b.goal.purchased) {
      return compareOptional(sortValue(a, 'completed') as string | null, sortValue(b, 'completed') as string | null, byString, 'desc');
    }
    return (
      compareOptional(a.goal.deadline || null, b.goal.deadline || null, byString, 'asc') ||
      a.goal.title.localeCompare(b.goal.title, locale)
    );
  }

  const av = sortValue(a, sort);
  const bv = sortValue(b, sort);
  const primary =
    sort === 'name'
      ? compareOptional(av as string | null, bv as string | null, (x, y) => x.localeCompare(y, locale), dir)
      : typeof av === 'number' || typeof bv === 'number'
        ? compareOptional(av as number | null, bv as number | null, byNumber, dir)
        : compareOptional(av as string | null, bv as string | null, byString, dir);
  return primary || a.goal.title.localeCompare(b.goal.title, locale);
}

export function filterGoalRows(rows: GoalRow[], filters: GoalFilters, today = new Date(), locale?: string): GoalRow[] {
  return rows
    .filter((row) => matchesGoalFilters(row, filters, today))
    .sort((a, b) => compareGoalRows(a, b, filters.sort, filters.dir, locale));
}

/* ------------------------------------------------------------------ */
/* Active filters                                                       */
/* ------------------------------------------------------------------ */

/** One removable chip. `clear` is the patch that removes exactly this filter. */
export interface ActiveGoalFilter {
  key: string;
  kind: 'status' | 'date' | 'target' | 'spent' | 'progress' | 'wallet' | 'category' | 'search';
  /** The value the label is built from — a status id, a band, a wallet id… */
  value: string;
  clear: Partial<GoalFilters>;
}

export function activeGoalFilters(filters: GoalFilters): ActiveGoalFilter[] {
  const out: ActiveGoalFilter[] = [];

  for (const status of filters.statuses) {
    out.push({
      key: `status:${status}`,
      kind: 'status',
      value: status,
      clear: { statuses: filters.statuses.filter((s) => s !== status) },
    });
  }
  if (filters.datePreset !== 'all' && goalPresetRange(filters)) {
    out.push({ key: 'date', kind: 'date', value: filters.datePreset, clear: { datePreset: 'all', from: '', to: '' } });
  }
  if (filters.minTarget.trim() || filters.maxTarget.trim()) {
    out.push({ key: 'target', kind: 'target', value: '', clear: { minTarget: '', maxTarget: '' } });
  }
  if (filters.minSpent.trim() || filters.maxSpent.trim()) {
    out.push({ key: 'spent', kind: 'spent', value: '', clear: { minSpent: '', maxSpent: '' } });
  }
  for (const band of filters.progress) {
    out.push({
      key: `progress:${band}`,
      kind: 'progress',
      value: band,
      clear: { progress: filters.progress.filter((b) => b !== band) },
    });
  }
  for (const id of filters.walletIds) {
    out.push({ key: `wallet:${id}`, kind: 'wallet', value: id, clear: { walletIds: filters.walletIds.filter((w) => w !== id) } });
  }
  for (const category of filters.categories) {
    out.push({
      key: `category:${category}`,
      kind: 'category',
      value: category,
      clear: { categories: filters.categories.filter((c) => c !== category) },
    });
  }
  if (filters.search.trim()) {
    out.push({ key: 'search', kind: 'search', value: filters.search.trim(), clear: { search: '' } });
  }
  return out;
}

/** Everything except the sort — sorting is not a filter and never hides a row. */
export function clearedGoalFilters(filters: GoalFilters): GoalFilters {
  return { ...DEFAULT_GOAL_FILTERS, sort: filters.sort, dir: filters.dir };
}

/* ------------------------------------------------------------------ */
/* Built-in presets                                                     */
/* ------------------------------------------------------------------ */

export const GOAL_FILTER_PRESETS = ['completedThisYear', 'readyToBuy', 'overdue', 'nearlyThere'] as const;
export type GoalFilterPreset = (typeof GOAL_FILTER_PRESETS)[number];

export function presetFilters(preset: GoalFilterPreset, current: GoalFilters): GoalFilters {
  const base = clearedGoalFilters(current);
  switch (preset) {
    case 'completedThisYear':
      return { ...base, statuses: ['purchased'], dateField: 'completed', datePreset: 'thisYear' };
    case 'readyToBuy':
      return { ...base, statuses: ['ready'] };
    case 'overdue':
      return { ...base, statuses: ['overdue'] };
    case 'nearlyThere':
      return { ...base, statuses: ['saving'], progress: ['75-99'] };
  }
}

/** True when the current filters are exactly what the preset would set. */
export function isPresetActive(preset: GoalFilterPreset, filters: GoalFilters): boolean {
  return encodeGoalFilters(presetFilters(preset, filters)) === encodeGoalFilters(filters);
}

/* ------------------------------------------------------------------ */
/* URL                                                                  */
/* ------------------------------------------------------------------ */

function pickList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const seen = new Set<T>();
  for (const part of raw.split(',')) {
    if ((allowed as readonly string[]).includes(part)) seen.add(part as T);
  }
  return [...seen];
}

function pickOne<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^\d*\.?\d*$/;

function pickDate(raw: string | null): string {
  return raw && DATE_RE.test(raw) ? raw : '';
}

function pickAmount(raw: string | null): string {
  return raw && AMOUNT_RE.test(raw) ? raw : '';
}

/** Free-text lists (wallet ids, categories) — `|`-joined, since a category may contain a comma. */
function pickFree(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split('|').map((part) => part.trim()).filter(Boolean))].slice(0, 50);
}

/**
 * Only non-default values are written, so a plain `#/goals` stays plain and a
 * shared link carries just what was chosen.
 */
export function encodeGoalFilters(filters: GoalFilters): string {
  const params = new URLSearchParams();
  const d = DEFAULT_GOAL_FILTERS;
  if (filters.search.trim()) params.set('q', filters.search.trim());
  if (filters.statuses.length) params.set('status', filters.statuses.join(','));
  if (filters.datePreset !== d.datePreset) {
    params.set('date', filters.datePreset);
    params.set('by', filters.dateField);
    if (filters.datePreset === 'custom') {
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
    }
  }
  if (filters.minTarget) params.set('tmin', filters.minTarget);
  if (filters.maxTarget) params.set('tmax', filters.maxTarget);
  if (filters.minSpent) params.set('smin', filters.minSpent);
  if (filters.maxSpent) params.set('smax', filters.maxSpent);
  if (filters.progress.length) params.set('pct', filters.progress.join(','));
  if (filters.walletIds.length) params.set('wallet', filters.walletIds.join('|'));
  if (filters.categories.length) params.set('cat', filters.categories.join('|'));
  if (filters.sort !== d.sort) params.set('sort', filters.sort);
  if (filters.dir !== d.dir) params.set('dir', filters.dir);
  return params.toString();
}

/** Anything unrecognised falls back to the default rather than throwing — a URL is user input. */
export function decodeGoalFilters(query: string): GoalFilters {
  const params = new URLSearchParams(query);
  const d = DEFAULT_GOAL_FILTERS;
  return {
    search: (params.get('q') ?? '').slice(0, 80),
    statuses: pickList(params.get('status'), GOAL_STATUS_FILTERS),
    dateField: pickOne(params.get('by'), GOAL_DATE_FIELDS, d.dateField),
    datePreset: pickOne(params.get('date'), GOAL_DATE_PRESETS, d.datePreset),
    from: pickDate(params.get('from')),
    to: pickDate(params.get('to')),
    minTarget: pickAmount(params.get('tmin')),
    maxTarget: pickAmount(params.get('tmax')),
    minSpent: pickAmount(params.get('smin')),
    maxSpent: pickAmount(params.get('smax')),
    progress: pickList(params.get('pct'), GOAL_PROGRESS_BANDS),
    walletIds: pickFree(params.get('wallet')),
    categories: pickFree(params.get('cat')),
    sort: pickOne(params.get('sort'), GOAL_SORT_KEYS, d.sort),
    dir: pickOne(params.get('dir'), ['asc', 'desc'] as const, d.dir),
  };
}

/* ------------------------------------------------------------------ */
/* The spending summary                                                 */
/* ------------------------------------------------------------------ */

export interface SpendBucket {
  key: string;
  amount: number;
  count: number;
  /** True when any goal in the bucket is an estimate. */
  estimated: boolean;
}

export interface SpendingSummary {
  /** Purchased goals among the filtered rows. */
  count: number;
  /** Σ spend, exact and estimated together — `estimatedCount` says whether it is mixed. */
  total: number;
  /** The part of `total` read from real expenses. */
  exactTotal: number;
  estimatedCount: number;
  estimatedTotal: number;
  average: number;
  /** Σ targetAmount of the same goals. */
  targetTotal: number;
  /** `total − targetTotal`: positive means paid more than planned. */
  overTarget: number;
  /** First and last purchase date among the counted goals. */
  firstDate: string;
  lastDate: string;
  /** `YYYY-MM`, oldest first. */
  byMonth: SpendBucket[];
  /** Largest first. Empty key = the expense was not found. */
  byCategory: SpendBucket[];
  byWallet: SpendBucket[];
}

function bucketise(rows: GoalRow[], keyOf: (row: GoalRow) => string): Map<string, SpendBucket> {
  const map = new Map<string, SpendBucket>();
  for (const row of rows) {
    if (!row.spend) continue;
    const key = keyOf(row);
    const bucket = map.get(key) ?? { key, amount: 0, count: 0, estimated: false };
    bucket.amount = round2(bucket.amount + row.spend.amount);
    bucket.count += 1;
    bucket.estimated = bucket.estimated || row.spend.estimated;
    map.set(key, bucket);
  }
  return map;
}

/**
 * What the completed goals among `rows` cost.
 *
 * Takes the *filtered* rows, so the panel always describes exactly the subset
 * on screen — "spent on travel goals this year" is a filter, not a second
 * control.
 */
export function summariseSpending(rows: GoalRow[]): SpendingSummary {
  const bought = rows.filter((row) => row.spend);
  let total = 0;
  let exactTotal = 0;
  let estimatedTotal = 0;
  let estimatedCount = 0;
  let targetTotal = 0;
  const dates: string[] = [];

  for (const row of bought) {
    const spend = row.spend as GoalSpend;
    total += spend.amount;
    targetTotal += Number(row.goal.targetAmount) || 0;
    if (spend.estimated) {
      estimatedTotal += spend.amount;
      estimatedCount += 1;
    } else {
      exactTotal += spend.amount;
    }
    if (spend.date) dates.push(spend.date);
  }
  dates.sort();

  const byMonth = [...bucketise(bought, (row) => (row.spend?.date ?? '').slice(0, 7)).values()]
    .filter((bucket) => bucket.key)
    .sort((a, b) => a.key.localeCompare(b.key));
  const largestFirst = (a: SpendBucket, b: SpendBucket) => b.amount - a.amount;

  return {
    count: bought.length,
    total: round2(total),
    exactTotal: round2(exactTotal),
    estimatedCount,
    estimatedTotal: round2(estimatedTotal),
    average: bought.length ? round2(total / bought.length) : 0,
    targetTotal: round2(targetTotal),
    overTarget: round2(total - targetTotal),
    firstDate: dates[0] ?? '',
    lastDate: dates[dates.length - 1] ?? '',
    byMonth,
    byCategory: [...bucketise(bought, (row) => row.spend?.category ?? '').values()].sort(largestFirst),
    byWallet: [...bucketise(bought, (row) => row.spend?.walletId ?? '').values()].sort(largestFirst),
  };
}
