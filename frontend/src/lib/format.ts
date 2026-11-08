/** Formatting helpers shared by every screen. */

export function formatMoney(
  value: number,
  currency = 'USD',
  locale = 'en-US',
  options: { compact?: boolean; signed?: boolean } = {},
): string {
  const amount = Number.isFinite(value) ? value : 0;
  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: options.compact && Math.abs(amount) >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: options.compact && Math.abs(amount) >= 10_000 ? 1 : 2,
    }).format(Math.abs(amount));
    const sign = amount < 0 ? '-' : options.signed && amount > 0 ? '+' : '';
    return `${sign}${formatted}`;
  } catch {
    // Unknown currency code typed into Settings — fall back to a plain number.
    return `${amount < 0 ? '-' : ''}${Math.abs(amount).toFixed(2)} ${currency}`;
  }
}

export function formatNumber(value: number, digits = 2, locale = 'en-US'): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

const COMPACT_UNITS: [number, string][] = [
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'k'],
];

/**
 * A short amount for tight spaces: 950, 1.2k, 10k, 125k, 1.5M, -3.4k.
 *
 * Under 1,000 it is the whole number. From there the leading part keeps one
 * decimal while it is a single digit (1.5k, 1.5M) and none after (10k,
 * 125k), and `.0` is dropped (1k, not 1.0k). Rounding that reaches the next
 * unit moves up to it — 999,999 is "1M", never "1000k". k/M/B in every
 * language, Thai included; only the digits and the decimal mark follow the
 * locale. No currency: the places that use this have no room for one.
 */
export function formatCompactAmount(value: number, locale = 'en-US'): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  let abs = Math.abs(value);
  const digits = (n: number, max: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: max, useGrouping: false }).format(n);

  if (Math.round(abs) < 1000) {
    const whole = Math.round(abs);
    return whole === 0 ? '0' : `${sign}${digits(whole, 0)}`;
  }
  for (let i = COMPACT_UNITS.length - 1; i >= 0; i -= 1) {
    const [size, suffix] = COMPACT_UNITS[i];
    const next = COMPACT_UNITS[i - 1];
    const scaled = abs / size;
    const places = scaled < 9.95 ? 1 : 0;
    const rounded = Number(scaled.toFixed(places));
    /* 999,999 rounds to 1000k: that is 1M, so try the next unit up. */
    if (rounded >= 1000 && next) continue;
    return `${sign}${digits(rounded, places)}${suffix}`;
  }
  abs = Math.round(abs / 1e9);
  return `${sign}${digits(abs, 0)}B`;
}

export function formatPercent(value: number, digits = 1, signed = false): string {
  if (!Number.isFinite(value)) return '0%';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatDate(iso: string, locale = 'en-US'): string {
  if (!iso) return '—';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatPeriod(period: string, locale = 'en-US'): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return period;
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/**
 * 1 -> "1st", 22 -> "22nd". Used wherever a billing day is shown.
 *
 * The teens are the whole trick: 11, 12 and 13 take "th" despite ending in
 * 1, 2 and 3, so they are excluded before the last digit is consulted.
 */
export function ordinal(day: number): string {
  const n = Math.round(Number(day) || 0);
  const lastTwo = n % 100;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13
      ? 'th'
      : n % 10 === 1
        ? 'st'
        : n % 10 === 2
          ? 'nd'
          : n % 10 === 3
            ? 'rd'
            : 'th';
  return `${n}${suffix}`;
}

/** "12 Mar" — a date key without the year, for figures inside one cycle. */
export function formatDayMonth(iso: string, locale = 'en-US'): string {
  if (!iso) return '—';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return 'never';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function todayKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function currentPeriod(): string {
  return todayKey().slice(0, 7);
}

export function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** `YYYY-MM` from a link or the hash, or null for anything else. */
export function parsePeriod(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : null;
}

/** Merges class names, dropping falsy entries. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
