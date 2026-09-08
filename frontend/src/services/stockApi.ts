import { Quote } from '../types';

/**
 * Live stock quotes for the Investments screen.
 *
 * Configure a free key in `frontend/.env.local`:
 *   VITE_STOCK_API_PROVIDER=finnhub|twelvedata|mock
 *   VITE_STOCK_API_KEY=...
 *
 * With no key the module returns clearly-labelled *simulated* quotes so the app
 * stays usable offline — unrealised P&L is then illustrative, not real.
 */

type Provider = 'finnhub' | 'twelvedata' | 'mock';

const PROVIDER = ((import.meta.env.VITE_STOCK_API_PROVIDER as string) || 'finnhub').toLowerCase() as Provider;
const API_KEY = (import.meta.env.VITE_STOCK_API_KEY as string) || '';
const TTL_MS = Math.max(15, Number(import.meta.env.VITE_STOCK_CACHE_TTL) || 60) * 1000;
const CACHE_PREFIX = 'quick-wallet.quote.';

const PLACEHOLDER_KEYS = new Set(['', 'YOUR_API_KEY_HERE', 'REPLACE_ME', 'undefined', 'null']);

export function hasLiveQuotes(): boolean {
  return PROVIDER !== 'mock' && !PLACEHOLDER_KEYS.has(API_KEY.trim());
}

export function providerName(): string {
  if (!hasLiveQuotes()) return 'simulated';
  return PROVIDER;
}

/* ------------------------------------------------------------------ */
/* Cache — sessionStorage so quotes survive a page reload but not a    */
/* browser restart, and free-tier rate limits stay happy.              */
/* ------------------------------------------------------------------ */

function readCache(symbol: string): Quote | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + symbol);
    if (!raw) return null;
    const quote = JSON.parse(raw) as Quote;
    if (Date.now() - quote.fetchedAt > TTL_MS) return null;
    return quote;
  } catch {
    return null;
  }
}

function writeCache(quote: Quote): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + quote.symbol, JSON.stringify(quote));
  } catch {
    // Private mode / quota — quotes just won't be cached.
  }
}

export function clearQuoteCache(): void {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Simulated quotes                                                    */
/* ------------------------------------------------------------------ */

/** Deterministic 0..1 from a string, so a symbol keeps the same drift. */
function seededUnit(symbol: string, salt: number): number {
  let hash = 2166136261;
  const input = `${symbol}:${salt}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function simulatedQuote(symbol: string, referencePrice: number): Quote {
  const base = referencePrice > 0 ? referencePrice : 100;
  // Drift changes every ~5 minutes so the number visibly "lives" without churn.
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const drift = (seededUnit(symbol, bucket) - 0.45) * 0.18; // roughly -8% .. +12%
  const price = Math.max(0.01, Number((base * (1 + drift)).toFixed(2)));
  const previousClose = Math.max(0.01, Number((base * (1 + drift * 0.7)).toFixed(2)));

  return {
    symbol,
    price,
    previousClose,
    changePercent: Number((((price - previousClose) / previousClose) * 100).toFixed(2)),
    currency: 'USD',
    fetchedAt: Date.now(),
    source: 'simulated',
  };
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

interface FinnhubQuote {
  c: number; // current
  d: number; // change
  dp: number; // change percent
  pc: number; // previous close
}

async function fetchFinnhub(symbol: string): Promise<Quote> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(API_KEY)}`;
  const response = await fetch(url);
  if (response.status === 429) throw new Error('Rate limit reached — try again in a minute');
  if (!response.ok) throw new Error(`Finnhub responded ${response.status}`);

  const data = (await response.json()) as FinnhubQuote;
  // Finnhub answers 200 with all-zeros for unknown symbols.
  if (!data || !Number.isFinite(data.c) || data.c === 0) {
    throw new Error(`No quote for "${symbol}"`);
  }

  return {
    symbol,
    price: data.c,
    previousClose: data.pc || data.c,
    changePercent: Number.isFinite(data.dp) ? data.dp : 0,
    currency: 'USD',
    fetchedAt: Date.now(),
    source: 'live',
  };
}

interface TwelveDataQuote {
  close?: string;
  previous_close?: string;
  percent_change?: string;
  currency?: string;
  status?: string;
  message?: string;
}

async function fetchTwelveData(symbol: string): Promise<Quote> {
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(API_KEY)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Twelve Data responded ${response.status}`);

  const data = (await response.json()) as TwelveDataQuote;
  if (data.status === 'error' || !data.close) {
    throw new Error(data.message || `No quote for "${symbol}"`);
  }

  const price = Number(data.close);
  const previousClose = Number(data.previous_close) || price;
  return {
    symbol,
    price,
    previousClose,
    changePercent: Number(data.percent_change) || 0,
    currency: data.currency || 'USD',
    fetchedAt: Date.now(),
    source: 'live',
  };
}

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

/**
 * Requests per minute the quote provider allows on its free tier.
 *
 * Finnhub has no batch endpoint on the free plan — `/quote` takes exactly one
 * symbol — so a watchlist of fifteen names is fifteen requests, and the only
 * honest lever is pacing rather than batching.
 *
 * This budget is separate from the candle API's, which talks to a different
 * vendor on a different key and enforces its own 8/min cooldown. Mixing the two
 * would have one screen's chart starve the other screen's prices.
 */
const RATE_LIMIT_PER_MINUTE: Record<Provider, number> = {
  finnhub: 60,
  twelvedata: 8,
  mock: Number.POSITIVE_INFINITY,
};

/** Leaves headroom: hitting the documented ceiling exactly still trips 429s. */
const RATE_BUDGET = Math.floor(RATE_LIMIT_PER_MINUTE[PROVIDER] * 0.8);
const WINDOW_MS = 60_000;

/** Timestamps of calls that actually reached the network, newest last. */
let recentCalls: number[] = [];

/**
 * Blocks until there is room in the sliding window.
 *
 * A sliding window rather than a fixed one: with a fixed 60s bucket, 15 calls
 * at 0:59 and 15 more at 1:01 both "fit" while actually being 30 calls in two
 * seconds, which is exactly what a 429 is for.
 *
 * Callers wait rather than fail. Every call site here is a background refresh
 * whose result is cached, so a two-second delay is invisible and a dropped
 * quote is not.
 */
async function takeRateSlot(): Promise<void> {
  if (!Number.isFinite(RATE_BUDGET)) return;

  for (;;) {
    const now = Date.now();
    recentCalls = recentCalls.filter((at) => now - at < WINDOW_MS);
    if (recentCalls.length < RATE_BUDGET) {
      recentCalls.push(now);
      return;
    }
    // Wait for the oldest call to age out of the window, plus a little.
    const wait = WINDOW_MS - (now - recentCalls[0]) + 50;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** Roughly how many calls are still available this minute. For diagnostics. */
export function quoteBudgetRemaining(): number {
  if (!Number.isFinite(RATE_BUDGET)) return Number.POSITIVE_INFINITY;
  const now = Date.now();
  return Math.max(0, RATE_BUDGET - recentCalls.filter((at) => now - at < WINDOW_MS).length);
}

/* ------------------------------------------------------------------ */
/* In-flight de-duplication                                            */
/* ------------------------------------------------------------------ */

/**
 * One network request per symbol at a time, shared by every caller.
 *
 * The Holdings table and the Watchlist can both want AAPL in the same tick —
 * one because it is owned, one because it is watched. Without this they would
 * each spend a request on it. With it, the second caller waits on the first
 * promise and the symbol costs one slot no matter how many screens ask.
 *
 * The shared request deliberately carries no AbortSignal: one component
 * unmounting must not cancel a fetch another component is still waiting on. The
 * caller's signal is honoured after the fact instead, which also means an
 * aborted request still lands in the cache rather than wasting the rate slot.
 */
const inflight = new Map<string, Promise<Quote>>();

function fetchLive(ticker: string): Promise<Quote> {
  const existing = inflight.get(ticker);
  if (existing) return existing;

  const request = takeRateSlot()
    .then(() => (PROVIDER === 'twelvedata' ? fetchTwelveData(ticker) : fetchFinnhub(ticker)))
    .finally(() => {
      inflight.delete(ticker);
    });

  inflight.set(ticker, request);
  return request;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface QuoteResult {
  quote: Quote | null;
  error: string | null;
}

/**
 * `referencePrice` (usually the position's average cost) is only used to make
 * simulated quotes land in a believable range.
 */
export async function fetchQuote(
  symbol: string,
  referencePrice = 0,
  signal?: AbortSignal,
): Promise<QuoteResult> {
  const ticker = symbol.trim().toUpperCase();
  if (!ticker) return { quote: null, error: 'Missing symbol' };

  const cached = readCache(ticker);
  if (cached) return { quote: cached, error: null };

  if (!hasLiveQuotes()) {
    const quote = simulatedQuote(ticker, referencePrice);
    writeCache(quote);
    return { quote, error: null };
  }

  try {
    // Paced and de-duplicated — see the two blocks above. One symbol is one
    // request no matter how many screens want it, and the provider's per-minute
    // budget is respected across all of them.
    const quote = await fetchLive(ticker);
    writeCache(quote);

    // The shared request ignores caller signals so it can be reused; honour
    // this caller's own abort now that the result is safely cached.
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    return { quote, error: null };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // Fall back to a simulated price so one bad ticker can't blank the screen.
    return {
      quote: simulatedQuote(ticker, referencePrice),
      error: err instanceof Error ? err.message : 'Quote lookup failed',
    };
  }
}

/** Fetches many symbols with a small concurrency cap (free tiers are strict). */
export async function fetchQuotes(
  requests: { symbol: string; referencePrice?: number }[],
  signal?: AbortSignal,
  concurrency = 4,
): Promise<{ quotes: Record<string, Quote>; errors: Record<string, string> }> {
  const quotes: Record<string, Quote> = {};
  const errors: Record<string, string> = {};
  const queue = [...requests];

  async function worker(): Promise<void> {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const { quote, error } = await fetchQuote(next.symbol, next.referencePrice ?? 0, signal);
      const key = next.symbol.trim().toUpperCase();
      if (quote) quotes[key] = quote;
      if (error) errors[key] = error;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { quotes, errors };
}
