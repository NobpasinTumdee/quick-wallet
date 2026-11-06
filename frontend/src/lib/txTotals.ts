import type { Transaction } from '../types';

/**
 * Activity's sums, in one place.
 *
 * The header ("in · out · net"), every day header and the selection bar all
 * call `sumTotals`, so they can never disagree about what counts:
 *
 *   income  = every row of type `income`   (reimbursements, refunds recorded
 *                                           as income, salary, …)
 *   expense = every row of type `expense`  (purchases, fees, debt payments,
 *                                           goal purchases, subscriptions, …)
 *   net     = income − expense
 *
 * Transfers move money between the user's own wallets and are in neither:
 * they are only counted, so a day of nothing but transfers can say so.
 *
 * Amounts are the stored (base-currency) values; the caller formats them with
 * the page's `money()`, which applies the display currency the same way for
 * every figure.
 */
export interface TxTotals {
  income: number;
  expense: number;
  net: number;
  /** Rows summed, of every type. */
  count: number;
  /** How many of them were transfers. */
  transfers: number;
}

export function sumTotals(rows: readonly Pick<Transaction, 'type' | 'amount'>[]): TxTotals {
  let income = 0;
  let expense = 0;
  let transfers = 0;
  for (const tx of rows) {
    const amount = Number(tx.amount) || 0;
    if (tx.type === 'income') income += amount;
    else if (tx.type === 'expense') expense += amount;
    else transfers += 1;
  }
  return { income, expense, net: income - expense, count: rows.length, transfers };
}

/** What a day header shows: all three figures when there are both kinds,
 *  the one figure when there is only one, or that it held only transfers. */
export type DaySummary =
  | { kind: 'full'; income: number; expense: number; net: number }
  | { kind: 'income'; income: number }
  | { kind: 'expense'; expense: number }
  | { kind: 'transfers'; transfers: number }
  | { kind: 'empty' };

export function daySummary(totals: TxTotals): DaySummary {
  const hasIncome = totals.income !== 0;
  const hasExpense = totals.expense !== 0;
  if (hasIncome && hasExpense) return { kind: 'full', income: totals.income, expense: totals.expense, net: totals.net };
  if (hasIncome) return { kind: 'income', income: totals.income };
  if (hasExpense) return { kind: 'expense', expense: totals.expense };
  if (totals.transfers > 0) return { kind: 'transfers', transfers: totals.transfers };
  return { kind: 'empty' };
}

export interface DayGroup<T> {
  key: string;
  date: string;
  rows: T[];
  totals: TxTotals;
}

/** Consecutive rows that share a date, in the list's own order, each with
 *  its totals — one pass over the list. */
export function groupByDay<T extends Pick<Transaction, 'date' | 'type' | 'amount'>>(rows: readonly T[]): DayGroup<T>[] {
  const groups: { key: string; date: string; rows: T[] }[] = [];
  for (const tx of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === tx.date) last.rows.push(tx);
    else groups.push({ key: `${tx.date}-${groups.length}`, date: tx.date, rows: [tx] });
  }
  return groups.map((group) => ({ ...group, totals: sumTotals(group.rows) }));
}

/* ---- Selection ----
   A set of row ids, only ever held in memory: it is a calculator, never
   saved, never sent. */

export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Shift+click: every row between the last one clicked (`anchor`) and this
 * one, in the order on screen, set to what this row is becoming. Without an
 * anchor still in the list it is a plain toggle.
 */
export function selectRange(
  selected: ReadonlySet<string>,
  order: readonly string[],
  anchor: string | null,
  target: string,
): Set<string> {
  const to = order.indexOf(target);
  const from = anchor === null ? -1 : order.indexOf(anchor);
  if (to === -1 || from === -1) return toggleSelected(selected, target);
  const on = !selected.has(target);
  const next = new Set(selected);
  const [lo, hi] = from < to ? [from, to] : [to, from];
  for (let index = lo; index <= hi; index += 1) {
    if (on) next.add(order[index]);
    else next.delete(order[index]);
  }
  return next;
}

/** A day's checkbox: none, some or all of its rows selected. */
export function groupState(ids: readonly string[], selected: ReadonlySet<string>): 'none' | 'some' | 'all' {
  let count = 0;
  for (const id of ids) if (selected.has(id)) count += 1;
  return count === 0 ? 'none' : count === ids.length ? 'all' : 'some';
}

/** The day checkbox: select the whole day, or clear it when it is all selected. */
export function toggleGroup(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(selected);
  if (groupState(ids, selected) === 'all') for (const id of ids) next.delete(id);
  else for (const id of ids) next.add(id);
  return next;
}

/** Rows that left the list (deleted, or filtered away) leave the selection.
 *  The same set back when nothing changed, so React can skip a render. */
export function pruneSelected(selected: ReadonlySet<string>, present: ReadonlySet<string>): ReadonlySet<string> {
  for (const id of selected) {
    if (!present.has(id)) {
      const next = new Set<string>();
      for (const kept of selected) if (present.has(kept)) next.add(kept);
      return next;
    }
  }
  return selected;
}
