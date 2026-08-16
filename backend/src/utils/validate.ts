import { StoreError } from '../db/excelStore';

export function bad(message: string, code = 'VALIDATION_ERROR'): StoreError {
  return new StoreError(message, 400, code);
}

export function str(value: unknown, field: string, { required = true, max = 500 } = {}): string {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (required && !s) throw bad(`"${field}" is required`);
  if (s.length > max) throw bad(`"${field}" must be ${max} characters or fewer`);
  return s;
}

export function num(
  value: unknown,
  field: string,
  { required = true, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {},
): number {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`"${field}" is required`);
    return fallback;
  }
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[, ]/g, ''));
  if (!Number.isFinite(n)) throw bad(`"${field}" must be a number`);
  if (n < min) throw bad(`"${field}" must be at least ${min}`);
  if (n > max) throw bad(`"${field}" must be at most ${max}`);
  return n;
}

export function bool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

export function oneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  const s = String(value ?? '').trim().toLowerCase() as T;
  if (allowed.includes(s)) return s;
  if (fallback !== undefined && !s) return fallback;
  throw bad(`"${field}" must be one of: ${allowed.join(', ')}`);
}

/** Normalises anything date-ish to YYYY-MM-DD. */
export function isoDate(value: unknown, field: string, { required = true } = {}): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`"${field}" is required`);
    return '';
  }
  const raw = String(value).trim();
  const direct = /^\d{4}-\d{2}-\d{2}$/.exec(raw);
  if (direct) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw bad(`"${field}" must be a valid date (YYYY-MM-DD)`);
  return toDateKey(parsed);
}

/** YYYY-MM period key. */
export function period(value: unknown, field = 'period', fallback?: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    if (fallback) return fallback;
    throw bad(`"${field}" is required (YYYY-MM)`);
  }
  if (!/^\d{4}-\d{2}$/.test(raw)) throw bad(`"${field}" must look like YYYY-MM`);
  return raw;
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentPeriod(): string {
  return toDateKey(new Date()).slice(0, 7);
}

/** Shifts a YYYY-MM period by `delta` months. */
export function shiftPeriod(periodKey: string, delta: number): string {
  const [y, m] = periodKey.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Money is stored as a plain number; round consistently to avoid 0.1+0.2 drift. */
export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
