import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useExcelDB } from './useExcelDB';
import {
  ActiveGoalFilter,
  DEFAULT_GOAL_FILTERS,
  GoalFilters,
  GoalRow,
  SpendingSummary,
  activeGoalFilters,
  buildGoalRows,
  clearedGoalFilters,
  decodeGoalFilters,
  encodeGoalFilters,
  filterGoalRows,
  purchaseWindow,
  summariseSpending,
} from '../lib/goalFilters';
import { Goal, Transaction } from '../types';

/**
 * The Goals screen's filter state, and everything derived from it.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE STATE LIVES
 * ---------------------------------------------------------------------------
 * In the URL first: `#/goals?status=purchased&date=thisYear` is a link that
 * can be shared, survives a refresh and comes back with the back button. The
 * router already ignores everything after `?`, so the query rides along
 * without the route noticing. It is written with `replaceState`, not by
 * assigning the hash — every keystroke in the search box would otherwise be
 * a history entry, and `hashchange` would fire for each one.
 *
 * `localStorage` second, for the person who opens Goals from the sidebar
 * (a bare `#/goals`) and expects their last view back. Every access is
 * wrapped: private windows and blocked storage throw, and that must never
 * cost the user the page.
 *
 * ---------------------------------------------------------------------------
 * WHERE "SPENT" COMES FROM
 * ---------------------------------------------------------------------------
 * The purchase expenses, fetched for exactly the dates goals were bought on
 * (see `purchaseWindow`). The default transactions list is the newest 500
 * rows, so an older purchase would be missing from it and every such goal
 * would read as an estimate. Disabled outright when nothing has been bought.
 */

const STORAGE_KEY = 'quick-wallet.goal-filters';
const SEARCH_DEBOUNCE_MS = 200;

function hashQuery(): string {
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  return at === -1 ? '' : hash.slice(at + 1);
}

function readStored(): GoalFilters | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : decodeGoalFilters(raw);
  } catch {
    return null;
  }
}

function writeStored(query: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, query);
  } catch {
    /* Storage unavailable: the URL still carries the state. */
  }
}

function initialFilters(): GoalFilters {
  const query = hashQuery();
  if (query) return decodeGoalFilters(query);
  return readStored() ?? DEFAULT_GOAL_FILTERS;
}

export interface GoalFiltersState {
  filters: GoalFilters;
  /** Merge a patch. Search typed through `setSearchInput` is debounced; this is not. */
  update: (patch: Partial<GoalFilters>) => void;
  replace: (next: GoalFilters) => void;
  clearAll: () => void;
  /** What the search box shows — ahead of `filters.search` by the debounce. */
  searchInput: string;
  setSearchInput: (value: string) => void;

  rows: GoalRow[];
  /** Filtered and sorted. */
  visible: GoalRow[];
  activeRows: GoalRow[];
  completedRows: GoalRow[];
  summary: SpendingSummary;
  chips: ActiveGoalFilter[];
  /** How many rows a different set of filters would leave — the sheet's "Show N". */
  countFor: (candidate: GoalFilters) => number;
  /** Wallet ids and categories that actually occur on purchases, for the pickers. */
  walletOptions: string[];
  categoryOptions: string[];
  /** True while the purchase expenses are still loading — spent figures may read as estimates until then. */
  spendLoading: boolean;
  refreshSpend: () => Promise<unknown>;
}

export function useGoalFilters(goals: Goal[], locale?: string): GoalFiltersState {
  const [filters, setFilters] = useState<GoalFilters>(initialFilters);
  const [searchInput, setSearchInputState] = useState(filters.search);
  const timer = useRef<number | undefined>();

  /* ---- Persist ---- */
  useEffect(() => {
    const query = encodeGoalFilters(filters);
    if (query !== hashQuery()) {
      const url = `${window.location.pathname}${window.location.search}#/goals${query ? `?${query}` : ''}`;
      try {
        window.history.replaceState(window.history.state, '', url);
      } catch {
        /* Some embedded browsers refuse replaceState; the filters still work. */
      }
    }
    writeStored(query);
  }, [filters]);

  /* A link pasted into the address bar while already on Goals. */
  useEffect(() => {
    const onHash = () => {
      if (!window.location.hash.startsWith('#/goals')) return;
      const query = hashQuery();
      setFilters((current) => {
        if (encodeGoalFilters(current) === query) return current;
        const next = decodeGoalFilters(query);
        setSearchInputState(next.search);
        return next;
      });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const update = useCallback((patch: Partial<GoalFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    if (patch.search !== undefined) {
      window.clearTimeout(timer.current);
      setSearchInputState(patch.search);
    }
  }, []);

  const replace = useCallback((next: GoalFilters) => {
    window.clearTimeout(timer.current);
    setFilters(next);
    setSearchInputState(next.search);
  }, []);

  const clearAll = useCallback(() => {
    window.clearTimeout(timer.current);
    setFilters((current) => clearedGoalFilters(current));
    setSearchInputState('');
  }, []);

  const setSearchInput = useCallback((value: string) => {
    setSearchInputState(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setFilters((current) => (current.search === value ? current : { ...current, search: value }));
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  /* ---- The purchase expenses ---- */
  const window_ = useMemo(() => purchaseWindow(goals), [goals]);
  const ledger = useExcelDB<Transaction>(
    'transactions',
    window_ ? { type: 'expense', from: window_.from, to: window_.to, limit: 5000 } : undefined,
    { enabled: Boolean(window_) },
  );

  /* A purchase today widens the window, which is a new cache key with nothing
     in it yet. The previous answer is held until the new one lands, so every
     completed goal does not flash to "≈ estimated" for the round trip. */
  const lastLedger = useRef<Transaction[]>([]);
  if (ledger.data) lastLedger.current = ledger.data;
  const ledgerRows = ledger.data ?? lastLedger.current;

  const txById = useMemo(() => {
    const map = new Map<string, Transaction>();
    if (window_) for (const tx of ledgerRows) map.set(tx.id, tx);
    return map;
  }, [ledgerRows, window_]);

  /* ---- Derived ---- */
  const rows = useMemo(() => buildGoalRows(goals, txById), [goals, txById]);
  const visible = useMemo(() => filterGoalRows(rows, filters, new Date(), locale), [rows, filters, locale]);
  const activeRows = useMemo(() => visible.filter((row) => !row.goal.purchased), [visible]);
  const completedRows = useMemo(() => visible.filter((row) => row.goal.purchased), [visible]);
  const summary = useMemo(() => summariseSpending(visible), [visible]);
  const chips = useMemo(() => activeGoalFilters(filters), [filters]);

  const countFor = useCallback(
    (candidate: GoalFilters) => filterGoalRows(rows, candidate, new Date(), locale).length,
    [rows, locale],
  );

  const walletOptions = useMemo(
    () => [...new Set(rows.map((row) => row.spend?.walletId ?? '').filter(Boolean))],
    [rows],
  );
  const categoryOptions = useMemo(
    () =>
      [...new Set(rows.map((row) => row.spend?.category ?? '').filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, locale),
      ),
    [rows, locale],
  );

  return {
    filters,
    update,
    replace,
    clearAll,
    searchInput,
    setSearchInput,
    rows,
    visible,
    activeRows,
    completedRows,
    summary,
    chips,
    countFor,
    walletOptions,
    categoryOptions,
    spendLoading: Boolean(window_) && ledger.initialLoading && lastLedger.current.length === 0,
    refreshSpend: ledger.refresh,
  };
}
