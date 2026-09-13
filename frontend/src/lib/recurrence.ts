import { Subscription } from '../types';

/**
 * Where a recurring bill lands next.
 *
 * Lives in `lib/` rather than beside the subscriptions hook because it is
 * arithmetic, not state: the liability heatmap projects a month of bills from
 * it without wanting React, a cache, or a fetch. `useSubscriptions` re-exports
 * it so existing call sites did not have to move.
 */

/** `YYYY-MM-DD` from a local-time Date. */
function toKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** Mirrors `advanceDueDate_` in Code.gs — see the note there about month ends. */
export function advanceDueDate(
  dateKey: string,
  frequency: Subscription['frequency'],
): string {
  const [year, month, day] = String(dateKey ?? '')
    .split('-')
    .map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return dateKey;

  if (frequency === 'weekly') return toKey(new Date(year, month - 1, day + 7));

  const step = frequency === 'yearly' ? 12 : 1;
  const target = month - 1 + step;
  const targetYear = year + Math.floor(target / 12);
  const targetMonth = ((target % 12) + 12) % 12;

  // Day 0 of the next month is the last day of the target month, so a bill on
  // the 31st lands on the 28th in February rather than overflowing into March.
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return toKey(new Date(targetYear, targetMonth, Math.min(day, lastDay)));
}
