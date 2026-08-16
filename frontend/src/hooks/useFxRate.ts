import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RateLookup, resolveRate } from '../services/fxApi';
import { toast } from '../lib/toast';

/**
 * Resolves "quote currency → bookkeeping currency" rates.
 *
 * Stock APIs price a ticker in its home market's currency (Finnhub returns USD
 * for US listings) while the cost basis in the sheet is in whatever currency the
 * user typed. Comparing the two without converting is the bug this fixes.
 *
 * Almost always this resolves a single pair (USD → THB); the map exists because
 * Twelve Data can return EUR/GBP/JPY for non-US listings.
 */

export interface FxState {
  /** Multiplier from a quote currency into the bookkeeping currency. */
  rateFor: (currency: string | undefined | null) => number;
  /** True once every currency in play has a usable rate. */
  ready: boolean;
  /** A rate could not be resolved and 1 is being used — figures are wrong. */
  degraded: boolean;
  /** Currencies still valued at 1:1 because no rate could be found. */
  unresolved: string[];
  rates: Record<string, RateLookup>;
  refresh: () => Promise<void>;
}

export function useFxRate(quoteCurrencies: string[], baseCurrency: string): FxState {
  const [rates, setRates] = useState<Record<string, RateLookup>>({});
  const mounted = useRef(true);
  /** One toast per bad pair, not one per refresh cycle. */
  const warned = useRef(new Set<string>());

  const base = (baseCurrency || 'USD').toUpperCase();

  // Stable key so the effect only re-runs when the currency set really changes.
  const key = useMemo(
    () =>
      [...new Set(quoteCurrencies.map((c) => (c || '').toUpperCase()).filter(Boolean))]
        .sort()
        .join(','),
    [quoteCurrencies],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const currencies = key ? key.split(',') : [];
      if (!currencies.length) {
        setRates({});
        return;
      }

      const resolved = await Promise.all(
        currencies.map(async (currency) => {
          const lookup = await resolveRate(currency, base, signal);
          return [currency, lookup] as const;
        }),
      );

      if (!mounted.current) return;

      const next: Record<string, RateLookup> = {};
      for (const [currency, lookup] of resolved) {
        next[currency] = lookup;
        if (lookup.source === 'none' && !warned.current.has(currency)) {
          warned.current.add(currency);
          toast.error(
            `Couldn't fetch the ${currency} → ${base} rate. ${currency} prices are shown unconverted, so P&L for those positions is wrong until it recovers.`,
            'Exchange rate unavailable',
          );
        }
      }
      setRates(next);
    },
    [key, base],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(async () => {
    warned.current.clear();
    await load();
  }, [load]);

  const rateFor = useCallback(
    (currency: string | undefined | null) => {
      const code = (currency || base).toUpperCase();
      if (code === base) return 1;
      return rates[code]?.rate ?? 1;
    },
    [rates, base],
  );

  const unresolved = useMemo(
    () =>
      Object.entries(rates)
        .filter(([, lookup]) => lookup.source === 'none')
        .map(([currency]) => currency),
    [rates],
  );

  return {
    rateFor,
    ready: !key || Object.keys(rates).length > 0,
    degraded: unresolved.length > 0,
    unresolved,
    rates,
    refresh,
  };
}
