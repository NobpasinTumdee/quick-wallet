/**
 * Optional exchange-rate lookup for the display currency (e.g. USD → THB).
 *
 * Uses open.er-api.com, which is free, needs no key and sends permissive CORS
 * headers. It is only ever called when you press "Fetch rate" — the app stays
 * fully offline otherwise, and the rate you save is what gets used.
 */

const ENDPOINT = 'https://open.er-api.com/v6/latest';

export interface FxResult {
  rate: number;
  /** When the provider last updated the rate, if it says. */
  asOf: string | null;
}

interface ErApiResponse {
  result?: string;
  'error-type'?: string;
  time_last_update_utc?: string;
  rates?: Record<string, number>;
}

export async function fetchRate(base: string, target: string, signal?: AbortSignal): Promise<FxResult> {
  const from = base.trim().toUpperCase();
  const to = target.trim().toUpperCase();

  if (!from || !to) throw new Error('Both currencies are required');
  if (from === to) return { rate: 1, asOf: null };

  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(from)}`, { signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error('Could not reach the rate provider — check your connection, or type the rate in manually.');
  }

  if (!response.ok) throw new Error(`Rate provider responded ${response.status}`);

  const data = (await response.json()) as ErApiResponse;
  if (data.result === 'error') {
    throw new Error(data['error-type'] === 'unsupported-code' ? `"${from}" is not a currency the provider knows` : 'Rate lookup failed');
  }

  const rate = data.rates?.[to];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`No ${from} → ${to} rate available`);
  }

  return { rate, asOf: data.time_last_update_utc ?? null };
}

/* ------------------------------------------------------------------ */
/* Quote-currency conversion                                           */
/* ------------------------------------------------------------------ */

/**
 * Rates used to normalise *stock quotes* into the bookkeeping currency.
 *
 * This is a different concern from the display conversion above:
 *   display  — base → displayCurrency, a user preference, stored in Settings
 *   quote    — quote currency → base, a market fact, cached here
 *
 * Finnhub prices US tickers in USD regardless of what your books are in, so a
 * THB cost basis has to be compared against a THB-converted live price.
 */

const RATE_STORE_KEY = 'quick-wallet.fx-rates';
/** A rate older than this is refreshed, but still usable in the meantime. */
export const RATE_FRESH_MS = 12 * 60 * 60 * 1000;

export interface StoredRate {
  rate: number;
  fetchedAt: number;
}

type RateStore = Record<string, StoredRate>;

function pairKey(from: string, to: string): string {
  return `${from.toUpperCase()}->${to.toUpperCase()}`;
}

function readStore(): RateStore {
  try {
    const raw = localStorage.getItem(RATE_STORE_KEY);
    return raw ? (JSON.parse(raw) as RateStore) : {};
  } catch {
    return {};
  }
}

/** Survives reloads and offline sessions, unlike the sessionStorage quote cache. */
export function readStoredRate(from: string, to: string): StoredRate | null {
  if (from.toUpperCase() === to.toUpperCase()) return { rate: 1, fetchedAt: Date.now() };
  return readStore()[pairKey(from, to)] ?? null;
}

function writeStoredRate(from: string, to: string, rate: number): void {
  try {
    const store = readStore();
    store[pairKey(from, to)] = { rate, fetchedAt: Date.now() };
    localStorage.setItem(RATE_STORE_KEY, JSON.stringify(store));
  } catch {
    // Private mode / quota — the rate just won't survive a reload.
  }
}

export interface RateLookup {
  rate: number;
  /** Where the number came from, so the UI can be honest about it. */
  source: 'live' | 'cached' | 'none';
  fetchedAt: number | null;
}

/**
 * Resolves one currency pair, preferring a live rate and degrading in steps:
 * live → cached (any age) → 1.
 *
 * Note it never falls back to `settings.fxRate`: that field is the base→display
 * rate, which is 1 whenever no display currency is set. Using it here would
 * quietly reinstate the 1:1 USD:THB comparison this module exists to prevent.
 */
export async function resolveRate(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<RateLookup> {
  const source = from.trim().toUpperCase();
  const target = to.trim().toUpperCase();

  if (!source || !target || source === target) {
    return { rate: 1, source: 'live', fetchedAt: Date.now() };
  }

  const cached = readStoredRate(source, target);
  const isFresh = cached && Date.now() - cached.fetchedAt < RATE_FRESH_MS;
  if (isFresh) return { rate: cached!.rate, source: 'cached', fetchedAt: cached!.fetchedAt };

  try {
    const { rate } = await fetchRate(source, target, signal);
    writeStoredRate(source, target, rate);
    return { rate, source: 'live', fetchedAt: Date.now() };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // A stale rate is far closer to the truth than no conversion at all.
    if (cached) return { rate: cached.rate, source: 'cached', fetchedAt: cached.fetchedAt };
    return { rate: 1, source: 'none', fetchedAt: null };
  }
}

/** Currencies offered as one-tap options in Settings. */
export const COMMON_CURRENCIES = [
  { code: 'THB', label: 'Thai baht' },
  { code: 'USD', label: 'US dollar' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'Pound sterling' },
  { code: 'JPY', label: 'Japanese yen' },
  { code: 'SGD', label: 'Singapore dollar' },
  { code: 'IDR', label: 'Indonesian rupiah' },
  { code: 'AUD', label: 'Australian dollar' },
];
