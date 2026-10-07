import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchQuote } from '../services/stockApi';
import { Quote } from '../types';

/**
 * Look up a ticker without committing to it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A COLLECTION HOOK
 * ---------------------------------------------------------------------------
 * Every other data hook in this app writes: `useExcelDB` caches a row, patches
 * it optimistically and syncs it to the sheet. That is the wrong shape here.
 * Checking what NVDA is trading at is a *question*, not a record — it should
 * leave nothing behind in the workbook, the watchlist, or the cache of rows
 * the portfolio renders from.
 *
 * So the result lives in component state and dies with the modal. The only
 * thing that persists is `stockApi`'s own short-lived quote cache, which is
 * shared with the portfolio and already bounded — looking up a symbol twice in
 * a minute costs one request, and looking it up at all costs the user nothing.
 *
 * Saving is a separate, explicit act: the quick view offers a button, and that
 * button goes through the ordinary watchlist write.
 */
export interface QuickQuoteState {
  /** The symbol currently being shown, upper-cased. Empty when idle. */
  symbol: string;
  quote: Quote | null;
  loading: boolean;
  error: string | null;
  /** Looks up a ticker. Safe to call repeatedly; earlier calls are abandoned. */
  lookup: (symbol: string) => void;
  /** Clears everything — used when the modal closes. */
  reset: () => void;
}

export function useQuickQuote(): QuickQuoteState {
  const [symbol, setSymbol] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Tracks the request in flight so a slower earlier lookup cannot overwrite a
     faster later one. Someone typing "AA", "AAP", "AAPL" fires three; without
     this the answer for "AA" can land last and sit under the heading "AAPL". */
  const activeRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const lookup = useCallback((raw: string) => {
    const ticker = raw.trim().toUpperCase();
    if (!ticker) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const id = activeRef.current + 1;
    activeRef.current = id;

    setSymbol(ticker);
    setQuote(null);
    setError(null);
    setLoading(true);

    /* `referencePrice` 0: there is no position to anchor a simulated price to,
       and `stockApi` handles that — it falls back to its seeded range. */
    fetchQuote(ticker, 0, controller.signal)
      .then((result) => {
        if (activeRef.current !== id) return;
        setQuote(result.quote);
        setError(result.quote ? null : result.error);
      })
      .catch((err: unknown) => {
        if (activeRef.current !== id) return;
        /* An abort is this hook's own doing, not a failure to report. */
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (activeRef.current === id) setLoading(false);
      });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    /* Bumping the id orphans any response still in flight, so a late arrival
       cannot repopulate a modal the user has already closed. */
    activeRef.current += 1;
    setSymbol('');
    setQuote(null);
    setError(null);
    setLoading(false);
  }, []);

  /* A lookup outliving its component would set state on an unmounted tree. */
  useEffect(() => () => abortRef.current?.abort(), []);

  return { symbol, quote, loading, error, lookup, reset };
}
