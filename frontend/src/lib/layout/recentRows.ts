/**
 * Home's Recent list, continued past the server's eight.
 *
 * The dashboard sends the user's newest eight transactions (Code.gs
 * `dashboardGet_`: every transaction, any date, sorted by `date + createdAt`
 * newest first). A taller Recent card shows more by reading on in the
 * year of rows the cash-flow chart has already loaded — `transactions.list`
 * over the same Transactions sheet, sorted by the very same key — so rows 9
 * and on are exactly the rows the server would have sent next: same order,
 * same fields, same inclusion rules. One list, no join visible.
 *
 * That only holds while the chart's rows cover everything after the eighth:
 *  - fewer than eight from the server means there is nothing more at all;
 *  - when the eighth is dated after the end of the chart's window (a past
 *    month is on screen and the user has newer transactions), the window
 *    does not reach it, so the list stops at eight;
 *  - while the chart's rows are still loading, eight.
 * Older than the window's first day, the rows simply run out — a prefix of
 * the true continuation, never a gap in it.
 *
 * Pure, so it is tested in node (tests/recentRows.test.mjs).
 */

export const SERVER_RECENT_COUNT = 8;
/** More than the tallest Recent card can show. */
const MAX_ROWS = 40;

interface RecentLike {
  id: string;
  date: string;
  createdAt: string;
}

/** The server's sort key and order (Code.gs: `String(b.date + b.createdAt).localeCompare(…)`). */
function sortKey(row: RecentLike): string {
  return String(row.date + row.createdAt);
}

export function compareRecent(a: RecentLike, b: RecentLike): number {
  return sortKey(b).localeCompare(sortKey(a));
}

/**
 * `recent` (the server's eight) followed by the rows that come after them,
 * from `history` (`null` while it loads). `windowTo` is the last day the
 * history covers, `YYYY-MM-DD`.
 */
export function continueRecent<T extends RecentLike>(recent: readonly T[], history: readonly T[] | null, windowTo: string): T[] {
  if (!history || recent.length < SERVER_RECENT_COUNT) return recent.slice();
  const last = recent[recent.length - 1];
  if (!last || last.date > windowTo) return recent.slice();

  const shown = new Set(recent.map((row) => row.id));
  const lastKey = sortKey(last);
  const after = history
    .filter((row) => !shown.has(row.id) && sortKey(row).localeCompare(lastKey) <= 0)
    .sort(compareRecent);

  const out = recent.slice();
  for (const row of after) {
    if (out.length >= MAX_ROWS) break;
    if (shown.has(row.id)) continue;
    shown.add(row.id);
    out.push(row);
  }
  return out;
}
