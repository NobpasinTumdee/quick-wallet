import { useMemo } from 'react';

import { CollectionState, useExcelDB } from './useExcelDB';
import { WatchlistItem } from '../types';

/* Re-exported so the page has one import for "watchlist things". The logic
   itself lives in lib/ where it can be tested without React. */
export { NEAR_BAND_PERCENT, targetProximity } from '../lib/watchlistTargets';
export type { TargetProximity, TargetState } from '../lib/watchlistTargets';

/**
 * The watchlist: symbols tracked but not owned.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A THIN WRAPPER
 * ---------------------------------------------------------------------------
 * All the machinery already exists. `useExcelDB` gives the stale-while-
 * revalidate cache, optimistic create/update/delete with rollback, and the
 * error toast, and the resource's sort and invalidation rules live in the
 * `RESOURCES` table beside every other collection's. Re-implementing any of
 * that here would be a second code path to keep in step for no gain.
 *
 * What this file adds is the one thing the screen actually needs and the cache
 * cannot know: the rows arranged by category.
 *
 * ---------------------------------------------------------------------------
 * PRICES ARE NOT HERE
 * ---------------------------------------------------------------------------
 * Deliberately. This hook owns rows in a spreadsheet; `useSymbolQuotes` owns
 * live prices from a rate-limited third party, with a completely different
 * refresh cadence and failure mode. Fusing them would mean a quote provider
 * outage looked like a database error, and a row edit would re-enter the quote
 * fetching path. The page composes the two.
 */

export interface WatchlistGroup {
  category: string;
  items: WatchlistItem[];
}

export interface WatchlistState extends CollectionState<WatchlistItem> {
  /** Rows bucketed by category, categories A→Z, symbols A→Z inside each. */
  groups: WatchlistGroup[];
  /** Every distinct category, for the "existing or new" input on the form. */
  categories: string[];
  /** Distinct uppercase tickers — what the quote hook wants. */
  symbols: string[];
  /** Case-insensitive lookup, so the form can warn before the server 409s. */
  findBySymbol: (symbol: string) => WatchlistItem | undefined;
}

export function useWatchlist(): WatchlistState {
  const collection = useExcelDB<WatchlistItem>('watchlist');
  const { items } = collection;

  const groups = useMemo<WatchlistGroup[]>(() => {
    const byCategory = new Map<string, WatchlistItem[]>();

    for (const item of items) {
      // The server never stores an empty category, but an optimistic row is
      // built on the client from whatever the form held, so default here too.
      const category = (item.category || 'Watching').trim() || 'Watching';
      const bucket = byCategory.get(category);
      if (bucket) bucket.push(item);
      else byCategory.set(category, [item]);
    }

    return [...byCategory.entries()]
      .map(([category, rows]) => ({
        category,
        items: [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol)),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [items]);

  const categories = useMemo(() => groups.map((group) => group.category), [groups]);

  const symbols = useMemo(
    () => [...new Set(items.map((item) => item.symbol.trim().toUpperCase()).filter(Boolean))],
    [items],
  );

  const findBySymbol = useMemo(() => {
    const index = new Map(items.map((item) => [item.symbol.trim().toUpperCase(), item]));
    return (symbol: string) => index.get(symbol.trim().toUpperCase());
  }, [items]);

  return { ...collection, groups, categories, symbols, findBySymbol };
}
