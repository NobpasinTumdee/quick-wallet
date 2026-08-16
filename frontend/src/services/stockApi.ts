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

async function fetchFinnhub(symbol: string, signal?: AbortSignal): Promise<Quote> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(API_KEY)}`;
  const response = await fetch(url, { signal });
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

async function fetchTwelveData(symbol: string, signal?: AbortSignal): Promise<Quote> {
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(API_KEY)}`;
  const response = await fetch(url, { signal });
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
    const quote =
      PROVIDER === 'twelvedata'
        ? await fetchTwelveData(ticker, signal)
        : await fetchFinnhub(ticker, signal);
    writeCache(quote);
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
