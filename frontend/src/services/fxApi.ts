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
