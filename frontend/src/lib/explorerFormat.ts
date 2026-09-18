import { DateBucket } from './explorerData';
import { TimeUnit } from './explorerScales';

/**
 * Number and date formatting for the explorer's axes and tooltips.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY DATE HERE IS FORMATTED IN UTC
 * ---------------------------------------------------------------------------
 * The data layer buckets in UTC (see `toTime`), so a month bucket is the
 * instant 2026-03-01T00:00Z. Formatted in local time, that instant is still
 * 28 February for anyone west of Greenwich, and the axis would label March's
 * bar "Feb". Formatting in the same zone the value was built in is the only way
 * the label and the bucket agree for every reader.
 */

export function formatExplorerNumber(value: number, locale: string, compact = false): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, {
    notation: compact && Math.abs(value) >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : Math.abs(value) < 1 && value !== 0 ? 4 : 2,
  }).format(value);
}

/** A time-axis tick, labelled at the unit the ticks were chosen at. */
export function formatTick(time: number, unit: TimeUnit, locale: string): string {
  const options: Intl.DateTimeFormatOptions =
    unit === 'year'
      ? { year: 'numeric' }
      : unit === 'day'
        ? { day: 'numeric', month: 'short' }
        : { month: 'short', year: '2-digit' };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(time);
}

/** A bucket key — `2026-03-14`, `2026-03` or `2026` — as a readable label. */
export function formatBucket(key: string, bucket: DateBucket, locale: string): string {
  const [year, month = '01', day = '01'] = key.split('-');
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (!Number.isFinite(time)) return key;
  const options: Intl.DateTimeFormatOptions =
    bucket === 'year'
      ? { year: 'numeric' }
      : bucket === 'month'
        ? { month: 'short', year: 'numeric' }
        : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(time);
}

/** A single instant, for a scatter point's tooltip. */
export function formatInstant(time: number, locale: string): string {
  if (!Number.isFinite(time)) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(time);
}
