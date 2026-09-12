/**
 * Loads daily candles for one symbol, with the states the UI has to render.
 *
 * ---------------------------------------------------------------------------
 * THE TWO-PATH RULE
 * ---------------------------------------------------------------------------
 * Twelve Data's free tier is 8 requests per minute, so a user scrubbing down
 * the positions table must not spend one request per row. Every symbol change
 * takes exactly one of two paths:
 *
 *   CACHE HIT   answered synchronously, in the same tick as the click.
 *               No timer is scheduled, no request is made, no spinner shows.
 *               AAPL -> MSFT -> AAPL costs two requests, never three.
 *
 *   CACHE MISS  schedules a 400ms timer. Any further symbol change clears it
 *               before it fires, so scrubbing through ten rows and stopping on
 *               the eleventh costs exactly one request.
 *
 * A manual reload skips both: it is an explicit act, so it fetches at once and
 * bypasses the cache.
 *
 * The debounce lives here rather than in `candleApi` because it is about user
 * intent — "are they still moving?" — not about the transport.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Candle,
  CandleError,
  CandleFailure,
  fetchCandles,
  rateLimitCooldown,
  readCandleCache,
} from '../services/candleApi';

/** Long enough to absorb a scroll through the table, short enough to feel instant. */
export const CANDLE_DEBOUNCE_MS = 400;

export interface CandleErrorState {
  kind: CandleFailure;
  message: string;
  hint: string;
}

export interface CandleState {
  candles: Candle[];
  /** Nothing to draw yet — drives the skeleton. */
  loading: boolean;
  /** Refetching over bars already on screen — dim, never re-skeleton. */
  refreshing: boolean;
  /** True when the bars on screen came from cache rather than the network. */
  fromCache: boolean;
  error: CandleErrorState | null;
  /** Seconds left on the rate-limit cooldown; 0 when not limited. */
  cooldown: number;
  reload: () => void;
}

export function useCandles(symbol: string | null, months = 12): CandleState {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<CandleErrorState | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  /** Set by `reload()`, consumed by the next effect run. */
  const forceRef = useRef(false);
  /** Guards against a slow response for symbol A landing after the user picked B. */
  const requestId = useRef(0);
  /** Bars currently on screen, read without making them an effect dependency. */
  const candlesRef = useRef<Candle[]>([]);
  candlesRef.current = candles;

  useEffect(() => {
    if (!symbol) {
      setCandles([]);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      setFromCache(false);
      return undefined;
    }

    const force = forceRef.current;
    forceRef.current = false;

    /* ---- path 1: cache hit, resolved in this tick ---- */
    if (!force) {
      const cached = readCandleCache(symbol, months);
      if (cached) {
        requestId.current += 1; // cancel any request still in flight
        setCandles(cached);
        setFromCache(true);
        setError(null);
        setLoading(false);
        setRefreshing(false);
        return undefined; // no timer, no network
      }
    }

    /* ---- path 2: cache miss, debounce then fetch ---- */
    const hadBars = candlesRef.current.length > 0;
    if (force && hadBars) setRefreshing(true);
    else setLoading(true);

    const id = ++requestId.current;
    let cancelled = false;

    const run = () => {
      void fetchCandles(symbol, { months, force })
        .then((next) => {
          if (cancelled || id !== requestId.current) return;
          setCandles(next);
          setFromCache(false);
          setError(null);
          setCooldown(0);
        })
        .catch((err: unknown) => {
          if (cancelled || id !== requestId.current) return;
          setCandles([]);
          setFromCache(false);
          setError(
            err instanceof CandleError
              ? { kind: err.kind, message: err.message, hint: err.hint }
              : {
                  kind: 'unknown',
                  message: err instanceof Error ? err.message : 'Could not load price history',
                  hint: 'The price provider returned an unexpected response.',
                },
          );
          setCooldown(rateLimitCooldown());
        })
        .finally(() => {
          if (cancelled || id !== requestId.current) return;
          setLoading(false);
          setRefreshing(false);
        });
    };

    // An explicit reload should not make the user wait out the debounce.
    if (force) {
      run();
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(run, CANDLE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      // The user moved on before the timer fired — this symbol never costs a request.
      window.clearTimeout(timer);
    };
  }, [symbol, months, reloadToken]);

  /* ---- count the cooldown down so the overlay can say how long is left ---- */
  useEffect(() => {
    if (error?.kind !== 'rate-limit') return undefined;

    const tick = () => setCooldown(rateLimitCooldown());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [error]);

  const reload = useCallback(() => {
    forceRef.current = true;
    setReloadToken((token) => token + 1);
  }, []);

  return { candles, loading, refreshing, fromCache, error, cooldown, reload };
}
