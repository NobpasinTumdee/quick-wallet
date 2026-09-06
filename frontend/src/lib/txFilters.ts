/**
 * Transaction filtering.
 *
 * ---------------------------------------------------------------------------
 * WHERE EACH FILTER RUNS, AND WHY
 * ---------------------------------------------------------------------------
 * The page used to send *every* filter to the server as a query param. Since
 * the request path is the cache key, changing the wallet dropdown produced a
 * brand new key and a fresh 1–3s Apps Script round trip — for data the browser
 * already had.
 *
 * So filters are split in two:
 *
 *   DATE RANGE  → server. It decides which rows are fetched at all, and the
 *                 client cannot filter into data it was never sent. A custom
 *                 range spans months, so it replaces the period entirely.
 *
 *   EVERYTHING  → client, over the rows already in the cache. Wallet, type,
 *   ELSE         category, text, amount and time-of-day are all instant, and
 *                they no longer fragment the cache: one key per date scope
 *                instead of one per filter combination.
 *
 * ---------------------------------------------------------------------------
 * ABOUT THE TIME-OF-DAY FILTER
 * ---------------------------------------------------------------------------
 * A Transaction's `date` is a `YYYY-MM-DD` date key — it carries no clock time.
 * The only timestamp on the row is `createdAt`, set when the row was written.
 *
 * So "show spending between 08:00 and 12:00" filters on **when it was
 * recorded**, not when the money moved. For a phone app where you log a coffee
 * as you buy it those are usually the same moment, but they are not the same
 * field, and the UI says so rather than implying a precision the sheet does not
 * store. Rows with no parseable `createdAt` are excluded while the filter is
 * on: including them would silently widen a window the user narrowed.
 */

import { Transaction, TransactionType } from '../types';
import { todayKey } from './format';

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

/**
 * `period` follows the month picker in the topbar; the rest override it.
 * `custom` is the only one that reads `from`/`to`.
 */
export type DatePreset = 'period' | 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

export interface TxFilters {
  datePreset: DatePreset;
  /** `YYYY-MM-DD`. Only read when `datePreset === 'custom'`. Empty = open ended. */
  from: string;
  to: string;
  /** `HH:MM` local. Both empty = no time filter. */
  timeFrom: string;
  timeTo: string;
  walletId: string;
  type: '' | TransactionType;
  category: string;
  search: string;
  /** Raw strings so a half-typed decimal survives; parsed on use. */
  minAmount: string;
  maxAmount: string;
}

export const EMPTY_FILTERS: TxFilters = {
  datePreset: 'period',
  from: '',
  to: '',
  timeFrom: '',
  timeTo: '',
  walletId: '',
  type: '',
  category: '',
  search: '',
  minAmount: '',
  maxAmount: '',
};

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

function toKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** `days` before today, in local time. Negative counts backwards. */
export function shiftDays(days: number, fromDate = new Date()): string {
  const next = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + days);
  return toKey(next);
}

/**
 * What to ask the server for.
 *
 * Returns query params, not a boolean — the caller feeds it straight to
 * `useExcelDB`, and the object's shape *is* the cache key. `period` and
 * `from`/`to` are mutually exclusive: the server ANDs them, so sending both
 * would quietly clamp a custom range to one month.
 */
export function fetchScope(
  filters: TxFilters,
  period: string,
  today = todayKey(),
): Record<string, string | number | undefined> {
  const range = presetRange(filters, today);
  if (!range) return { period };

  return {
    from: range.from || undefined,
    to: range.to || undefined,
    // The server defaults to 500 rows. A multi-month range can exceed that, and
    // a silently truncated list is worse than a slower one.
    limit: 2000,
  };
}

/**
 * The date window a preset describes, or null when it means "use the month
 * picker" — in which case the server's `period` filter already did the work.
 */
export function presetRange(
  filters: TxFilters,
  today = todayKey(),
): { from: string; to: string } | null {
  switch (filters.datePreset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = shiftDays(-1);
      return { from: day, to: day };
    }
    case 'last7':
      // Inclusive of today, so "last 7 days" is 7 days, not 8.
      return { from: shiftDays(-6), to: today };
    case 'last30':
      return { from: shiftDays(-29), to: today };
    case 'custom':
      return { from: filters.from, to: filters.to };
    case 'period':
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Time of day                                                         */
/* ------------------------------------------------------------------ */

/** `HH:MM` → minutes since local midnight. Null when unparseable or empty. */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** When the row was written, as minutes since local midnight. */
export function recordedMinutes(tx: Pick<Transaction, 'createdAt'>): number | null {
  if (!tx.createdAt) return null;
  const at = new Date(tx.createdAt);
  if (Number.isNaN(at.getTime())) return null;
  return at.getHours() * 60 + at.getMinutes();
}

/**
 * Is `minutes` inside the window?
 *
 * A window whose end is before its start wraps around midnight — 22:00 → 02:00
 * is a real thing to ask for ("what am I buying late at night?") and reading it
 * as an empty range would be useless. Either bound alone is open-ended.
 */
export function withinClockWindow(minutes: number, start: number | null, end: number | null): boolean {
  if (start === null && end === null) return true;
  if (start === null) return minutes <= (end as number);
  if (end === null) return minutes >= start;
  return start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
}

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

function amountOf(raw: string): number | null {
  const value = Number(String(raw).trim());
  return String(raw).trim() && Number.isFinite(value) ? value : null;
}

/**
 * The client-side pass.
 *
 * The date bounds are re-applied here even though the server already filtered
 * on them: while a range change is in flight the cache still holds the previous
 * scope's rows, and without this the list would flash rows from outside the
 * window the user just chose.
 */
export function filterTransactions(
  rows: Transaction[],
  filters: TxFilters,
  today = todayKey(),
): Transaction[] {
  const range = presetRange(filters, today);
  const startMinutes = parseClock(filters.timeFrom);
  const endMinutes = parseClock(filters.timeTo);
  const timed = startMinutes !== null || endMinutes !== null;
  const needle = filters.search.trim().toLowerCase();
  const min = amountOf(filters.minAmount);
  const max = amountOf(filters.maxAmount);
  const category = filters.category.trim().toLowerCase();

  return rows.filter((tx) => {
    if (range?.from && tx.date < range.from) return false;
    if (range?.to && tx.date > range.to) return false;

    if (filters.type && tx.type !== filters.type) return false;

    // A transfer touches two wallets, and filtering by the destination wallet
    // has to find it — same rule the server applies.
    if (filters.walletId && tx.walletId !== filters.walletId && tx.toWalletId !== filters.walletId) {
      return false;
    }

    if (category && String(tx.category).toLowerCase() !== category) return false;

    if (needle) {
      const haystack = `${tx.note ?? ''} ${tx.category ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    const amount = Number(tx.amount) || 0;
    if (min !== null && amount < min) return false;
    if (max !== null && amount > max) return false;

    if (timed) {
      const minutes = recordedMinutes(tx);
      if (minutes === null) return false;
      if (!withinClockWindow(minutes, startMinutes, endMinutes)) return false;
    }

    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

/** One entry per filter the user has actually set. Drives the chips and badge. */
export interface ActiveFilter {
  key: keyof TxFilters | 'time' | 'amount';
  label: string;
  /** The patch that clears just this one. */
  clear: Partial<TxFilters>;
}

const PRESET_LABELS: Record<DatePreset, string> = {
  period: '',
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  custom: 'Custom range',
};

export function activeFilters(
  filters: TxFilters,
  lookups: { walletName: (id: string) => string } = { walletName: (id) => id },
): ActiveFilter[] {
  const active: ActiveFilter[] = [];

  if (filters.datePreset !== 'period') {
    const label =
      filters.datePreset === 'custom'
        ? `${filters.from || '…'} → ${filters.to || '…'}`
        : PRESET_LABELS[filters.datePreset];
    active.push({
      key: 'datePreset',
      label,
      clear: { datePreset: 'period', from: '', to: '' },
    });
  }

  if (filters.timeFrom || filters.timeTo) {
    active.push({
      key: 'time',
      label: `${filters.timeFrom || '00:00'}–${filters.timeTo || '23:59'}`,
      clear: { timeFrom: '', timeTo: '' },
    });
  }

  if (filters.walletId) {
    active.push({
      key: 'walletId',
      label: lookups.walletName(filters.walletId),
      clear: { walletId: '' },
    });
  }

  if (filters.type) active.push({ key: 'type', label: filters.type, clear: { type: '' } });

  if (filters.category) {
    active.push({ key: 'category', label: filters.category, clear: { category: '' } });
  }

  if (filters.search.trim()) {
    active.push({ key: 'search', label: `"${filters.search.trim()}"`, clear: { search: '' } });
  }

  if (filters.minAmount.trim() || filters.maxAmount.trim()) {
    active.push({
      key: 'amount',
      label: `${filters.minAmount.trim() || '0'} – ${filters.maxAmount.trim() || '∞'}`,
      clear: { minAmount: '', maxAmount: '' },
    });
  }

  return active;
}
