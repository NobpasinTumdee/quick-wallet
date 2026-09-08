import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchQuotes, hasLiveQuotes, providerName } from '../services/stockApi';
import { Quote } from '../types';

/**
 * Live prices for an arbitrary list of symbols.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS ALONGSIDE useStockQuotes
 * ---------------------------------------------------------------------------
 * `useStockQuotes` takes `Investment[]` and returns a *valuation* — cost basis,
 * FX conversion, unrealised P&L. None of that means anything for a symbol you
 * do not own: there is no cost to compare against and nothing to convert.
 * Widening that hook to cope with cost-less rows would have put `if (owned)`
 * branches through the middle of the P&L maths, which is the one part of this
 * app that must stay obvious.
 *
 * So this is the smaller half: symbols in, quotes out.
 *
 * ---------------------------------------------------------------------------
 * WHAT KEEPS THE PROVIDER HAPPY
 * ---------------------------------------------------------------------------
 * Nothing here talks to the network directly. `stockApi` holds the session
 * quote cache, a sliding-window rate limiter and per-symbol request
 * de-duplication, all shared with the holdings hook — so a symbol that is both
 * owned and watched costs exactly one request, and the two hooks cannot
 * together exceed the provider's per-minute budget.
 *
 * The only thing this hook adds is a slower cadence. A position you own is
 * worth re-pricing every minute; a name you are merely watching is not, and on
 * a free tier every avoided request is one the chart can use instead.
 */

/** Watched names refresh far less often than owned ones. */
const DEFAULT_REFRESH_MS = 3 * 60 * 1000;

export interface SymbolQuotesState {
  quotes: Record<string, Quote>;
  errors: Record<string, string>;
  loading: boolean;
  lastUpdated: number | null;
  /** Bypasses the session cache for these symbols. */
  refresh: () => Promise<void>;
  isLive: boolean;
  provider: string;
}

export function useSymbolQuotes(
  symbols: string[],
  refreshMs = DEFAULT_REFRESH_MS,
): SymbolQuotesState {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const mounted = useRef(true);

  /* A stable string key, so passing a fresh array literal on every render does
     not restart the fetch effect. Same trick useStockQuotes uses. */
  const symbolKey = useMemo(
    () =>
      [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort().join(','),
    [symbols],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const list = symbolKey ? symbolKey.split(',') : [];
      if (!list.length) {
        setQuotes({});
        setErrors({});
        return;
      }

      setLoading(true);
      try {
        // `referencePrice` is only used to make *simulated* quotes plausible,
        // and a watched symbol has no cost basis to seed one from. Zero lets
        // stockApi fall back to its own default rather than inventing a price
        // from a number that does not exist.
        const result = await fetchQuotes(
          list.map((symbol) => ({ symbol })),
          signal,
        );
        if (!mounted.current) return;
        setQuotes(result.quotes);
        setErrors(result.errors);
        setLastUpdated(Date.now());
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        if (mounted.current) setErrors({ _: (err as Error).message });
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [symbolKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!refreshMs || !symbolKey) return undefined;
    const timer = window.setInterval(() => void load(), refreshMs);
    return () => window.clearInterval(timer);
  }, [load, refreshMs, symbolKey]);

  /* Note there is no `clearQuoteCache()` here, unlike the holdings hook: that
     would also drop every owned position's quote and force the whole portfolio
     to re-fetch. This just re-reads, which returns cached values for anything
     still fresh and spends requests only on what has expired. */
  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return {
    quotes,
    errors,
    loading,
    lastUpdated,
    refresh,
    isLive: hasLiveQuotes(),
    provider: providerName(),
  };
}
