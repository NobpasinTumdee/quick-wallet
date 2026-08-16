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

/** Merges class names, dropping falsy entries. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
