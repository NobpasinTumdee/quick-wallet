/**
 * Daily OHLC candles — Twelve Data only.
 *
 * ---------------------------------------------------------------------------
 * DUAL-PROVIDER SPLIT
 * ---------------------------------------------------------------------------
 * Quotes and candles deliberately use different vendors and different keys, so
 * each free tier is spent on what it is good at:
 *
 *   quotes   stockApi.ts   VITE_STOCK_API_PROVIDER + VITE_STOCK_API_KEY
 *   candles  this file     VITE_TWELVEDATA_API_KEY
 *
 * Finnhub is not an option here: it moved `/stock/candle` behind a paid plan
 * and answers a free key with 403. Twelve Data's `/time_series` returns the
 * same daily OHLC on its free tier.
 *
 * ---------------------------------------------------------------------------
 * THE RATE LIMIT IS THE DESIGN CONSTRAINT
 * ---------------------------------------------------------------------------
 * Twelve Data's free tier allows 8 requests per minute. Three things keep us
 * under it, and they matter in this order:
 *
 *   1. `readCandleCache()` is synchronous, so the hook can answer a repeat
 *      symbol with zero network and zero delay.
 *   2. in-flight de-duplication — two callers asking for AAPL at once share
 *      one request.
 *   3. a cooldown after a 429, so a limit breach cannot be turned into a
 *      retry storm.
 *
 * The 400ms debounce lives in `useCandles`, because it is about user intent
 * (still scrolling the table) rather than about the transport.
 */

/** One daily bar, in the shape lightweight-charts consumes directly. */
export interface Candle {
  /** `YYYY-MM-DD`. A BusinessDay string, so no timezone can shift a bar. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type CandleFailure =
  | 'rate-limit' // 8/min free tier exceeded
  | 'unauthorized' // bad or missing key
  | 'not-found' // no such symbol
  | 'no-data' // valid symbol, nothing in the window
  | 'network' // offline, CORS, DNS
  | 'unknown';

export class CandleError extends Error {
  kind: CandleFailure;
  /** Copy the UI can show verbatim. */
  hint: string;
  /** For 'rate-limit': roughly how many seconds until it is worth retrying. */
  retryAfter?: number;

  constructor(kind: CandleFailure, message: string, hint: string, retryAfter?: number) {
    super(message);
    this.name = 'CandleError';
    this.kind = kind;
    this.hint = hint;
    this.retryAfter = retryAfter;
  }
}

/* Read through a guard rather than touching import.meta.env directly: the
   transforms below are pure and worth exercising outside a bundler, where
   import.meta.env does not exist. */
const ENV: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string> }).env ?? {};

const TWELVEDATA_KEY = (ENV.VITE_TWELVEDATA_API_KEY || '').trim();
const PLACEHOLDER_KEYS = new Set([
  '',
  'YOUR_TWELVEDATA_API_KEY',
  'YOUR_API_KEY_HERE',
  'REPLACE_ME',
  'undefined',
  'null',
]);

/** Candles move once a day, so a long TTL is free accuracy and cheap quota. */
export const CANDLE_TTL_MS = 30 * 60 * 1000;
const CACHE_PREFIX = 'quick-wallet.candles.v2.';

/** Free tier is 8 requests/minute. After a 429, hold off rather than retry. */
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;

export function hasLiveCandles(): boolean {
  return !PLACEHOLDER_KEYS.has(TWELVEDATA_KEY);
}

export function candleProviderName(): string {
  return hasLiveCandles() ? 'twelvedata' : 'simulated';
}

/* ------------------------------------------------------------------ */
/* Transforms                                                          */
/* ------------------------------------------------------------------ */

/** Unix seconds -> `YYYY-MM-DD`, in UTC so the bar never lands on the wrong day. */
export function toBusinessDay(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Ascending by date, one bar per day, no half-populated rows.
 *
 * lightweight-charts throws on unordered or duplicated times, and silently
 * renders nonsense for a bar whose high is below its low, so both are enforced
 * here rather than trusted from the wire.
 */
function normalise(candles: Candle[]): Candle[] {
  const byDay = new Map<string, Candle>();

  for (const candle of candles) {
    const { time, open, high, low, close } = candle;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(time)) continue;
    if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) continue;

    byDay.set(time, {
      time,
      open,
      close,
      // Defend the invariant rather than assume it: a swapped pair draws an
      // inverted wick that looks like real data.
      high: Math.max(open, high, low, close),
      low: Math.min(open, high, low, close),
    });
  }

  return [...byDay.values()].sort((a, b) => a.time.localeCompare(b.time));
}

/** Twelve Data returns `{ values: [{ datetime, open, high, low, close }] }`, newest first. */
export interface TwelveDataCandles {
  values?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
}

export function candlesFromTwelveData(raw: TwelveDataCandles | null | undefined): Candle[] {
  if (!raw || !Array.isArray(raw.values)) return [];

  const candles: Candle[] = [];
  for (const row of raw.values as Record<string, unknown>[]) {
    if (!row) continue;
    candles.push({
      // Intraday plans return "2026-08-21 09:30:00"; keep the day.
      time: String(row.datetime ?? '').slice(0, 10),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    });
  }

  return normalise(candles); // also flips it to ascending
}

/* ------------------------------------------------------------------ */
/* Simulated candles                                                   */
/* ------------------------------------------------------------------ */

/**
 * A deterministic random walk, used when no Twelve Data key is configured —
 * the same role the `mock` provider plays for quotes. Seeded from the symbol so
 * a ticker always draws the same series. Labelled "simulated" in the UI.
 */
export function simulatedCandles(symbol: string, days: number): Candle[] {
  let seed = 0;
  for (let i = 0; i < symbol.length; i += 1) seed = (seed * 31 + symbol.charCodeAt(i)) >>> 0;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const candles: Candle[] = [];
  let price = 40 + random() * 260;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);

  for (let i = 0; i < days; i += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    // Markets are shut at the weekend, and a gapless series looks fake.
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;

    const open = price;
    const close = Math.max(1, open + (random() - 0.48) * open * 0.03);
    const wick = open * 0.012 * random();

    candles.push({
      time: toBusinessDay(Math.floor(day.getTime() / 1000)),
      open,
      close,
      high: Math.max(open, close) + wick,
      low: Math.max(0.5, Math.min(open, close) - wick),
    });
    price = close;
  }

  return normalise(candles);
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  fetchedAt: number;
  candles: Candle[];
}

function cacheKey(symbol: string, months: number): string {
  return `${CACHE_PREFIX}${symbol}.${months}`;
}

/**
 * Synchronous cache read — the load-bearing piece of the rate-limit strategy.
 *
 * Because this needs no await, `useCandles` can answer a repeat symbol during
 * the same tick as the click: no debounce wait, no request, no spinner. AAPL →
 * MSFT → AAPL costs exactly two requests, not three.
 */
export function readCandleCache(symbol: string, months = 12): Candle[] | null {
  const ticker = String(symbol ?? '').trim().toUpperCase();
  if (!ticker) return null;

  try {
    const raw = sessionStorage.getItem(cacheKey(ticker, months));
    if (!raw) return null;

    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry || !Array.isArray(entry.candles) || !entry.candles.length) return null;
    if (!Number.isFinite(entry.fetchedAt)) return null;
    if (Date.now() - entry.fetchedAt > CANDLE_TTL_MS) return null;

    return entry.candles;
  } catch {
    return null;
  }
}

function writeCache(symbol: string, months: number, candles: Candle[]): void {
  try {
    sessionStorage.setItem(
      cacheKey(symbol, months),
      JSON.stringify({ fetchedAt: Date.now(), candles } satisfies CacheEntry),
    );
  } catch {
    // Private mode or quota — candles just won't be cached.
  }
}

export function clearCandleCache(): void {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Rate-limit state                                                    */
/* ------------------------------------------------------------------ */

/** Set when the API returns 429; blocks outbound requests until it passes. */
let cooldownUntil = 0;

/** Seconds left on the cooldown, or 0. Lets the UI count down honestly. */
export function rateLimitCooldown(): number {
  const remaining = cooldownUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function rateLimitError(seconds: number): CandleError {
  return new CandleError(
    'rate-limit',
    'Rate limit reached (8/min). Please wait a moment.',
    'Twelve Data allows 8 requests per minute on the free tier. Loaded symbols are cached for 30 minutes, so switching back to one you have already viewed still works instantly. Live prices are unaffected — they use a separate provider and key.',
    seconds,
  );
}

/* De-duplicate concurrent requests for the same symbol. Two components
   mounting at once must not each spend a request from the minute's budget. */
const inFlight = new Map<string, Promise<Candle[]>>();

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

export interface CandleOptions {
  /** How far back to fetch. Defaults to a year. */
  months?: number;
  /** Bypass the session cache. Still respects the 429 cooldown. */
  force?: boolean;
}

async function requestTwelveData(ticker: string, days: number): Promise<Candle[]> {
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}` +
    `&interval=1day&outputsize=${days}&apikey=${encodeURIComponent(TWELVEDATA_KEY)}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new CandleError(
      'network',
      'Could not reach Twelve Data',
      'Check your connection. The rest of the app keeps working — only price history needs the internet.',
    );
  }

  if (response.status === 429) {
    cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    throw rateLimitError(Math.ceil(RATE_LIMIT_COOLDOWN_MS / 1000));
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new CandleError(
        'unauthorized',
        'API key rejected',
        'Check VITE_TWELVEDATA_API_KEY in frontend/.env.local, then restart the dev server.',
      );
    }
    if (response.status === 404) {
      throw new CandleError('not-found', 'Symbol not found', 'Twelve Data has no daily history for that symbol.');
    }
    throw new CandleError('unknown', `Request failed (${response.status})`, 'Twelve Data returned an unexpected response.');
  }

  const raw = (await response.json()) as TwelveDataCandles;

  // Twelve Data reports most failures as HTTP 200 with an error body, so the
  // status code alone is not enough to know the request succeeded.
  if (raw && raw.status === 'error') {
    const code = Number(raw.code);
    const message = String(raw.message ?? 'Request rejected');

    if (code === 429) {
      cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      throw rateLimitError(Math.ceil(RATE_LIMIT_COOLDOWN_MS / 1000));
    }
    if (code === 401) throw new CandleError('unauthorized', 'API key rejected', message);
    if (code === 404) throw new CandleError('not-found', 'Symbol not found', message);
    throw new CandleError('unknown', message, message);
  }

  return candlesFromTwelveData(raw);
}

/**
 * Daily candles for one symbol, oldest first.
 *
 * Never returns a partial series: on any failure it throws a `CandleError`
 * carrying a `kind` and a `hint`, so the caller renders one accurate message.
 */
export async function fetchCandles(symbol: string, options: CandleOptions = {}): Promise<Candle[]> {
  const ticker = String(symbol ?? '').trim().toUpperCase();
  if (!ticker) return [];

  const months = Math.min(24, Math.max(1, options.months ?? 12));
  const days = Math.round(months * 30.44);

  if (!options.force) {
    const cached = readCandleCache(ticker, months);
    if (cached) return cached;
  }

  if (!hasLiveCandles()) {
    const candles = simulatedCandles(ticker, days);
    writeCache(ticker, months, candles);
    return candles;
  }

  // Fail fast while the limit is still hot rather than spending a request to
  // be told 429 again.
  const cooling = rateLimitCooldown();
  if (cooling > 0) throw rateLimitError(cooling);

  const key = cacheKey(ticker, months);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = requestTwelveData(ticker, days)
    .then((candles) => {
      if (!candles.length) {
        throw new CandleError('no-data', 'No price history', `${ticker} returned no daily bars for this window.`);
      }
      writeCache(ticker, months, candles);
      return candles;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}
