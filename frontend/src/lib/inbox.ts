import { todayKey } from './format';
import { InboxItem, InboxType, TransactionType } from '../types';

/**
 * The inbox's small decisions, kept out of the component.
 *
 * Three of them matter enough to be testable: what counts as overdue, what a
 * converted transaction should say, and what a typed line means when the user
 * never opened the extra fields.
 */

/**
 * Past its date, and still open.
 *
 * Compared as `YYYY-MM-DD` strings rather than as Dates: both sides are
 * already calendar days in the user's own locale, and going through `Date`
 * would reintroduce the timezone question — an item due "today" in Bangkok
 * turning red because UTC has not got there yet.
 *
 * Today is never overdue. A bill due today is due today.
 */
export function isOverdue(item: InboxItem, today = todayKey()): boolean {
  return item.status === 'pending' && Boolean(item.dueDate) && item.dueDate < today;
}

/** Due today or tomorrow, and still open — the "soon" chip. */
export function isDueSoon(item: InboxItem, today = todayKey()): boolean {
  if (item.status !== 'pending' || !item.dueDate || item.dueDate < today) return false;
  return item.dueDate <= addDays(today, 1);
}

function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface InboxSummary {
  pending: number;
  overdue: number;
  /** Σ amounts of pending `to-pay` items. */
  owed: number;
  /** Σ amounts of pending `to-receive` items. */
  owedToYou: number;
}

/**
 * The header line.
 *
 * The two totals are kept apart rather than netted. "You owe 900, you are owed
 * 900" and "you are square" are different facts about different people, and a
 * single net figure of zero would hide both of them.
 */
export function summarizeInbox(items: InboxItem[], today = todayKey()): InboxSummary {
  const summary: InboxSummary = { pending: 0, overdue: 0, owed: 0, owedToYou: 0 };

  for (const item of items) {
    if (item.status !== 'pending') continue;
    summary.pending += 1;
    if (isOverdue(item, today)) summary.overdue += 1;
    if (item.type === 'to-pay') summary.owed = round2(summary.owed + item.amount);
    if (item.type === 'to-receive') summary.owedToYou = round2(summary.owedToYou + item.amount);
  }

  return summary;
}

/** Which way a converted item points. `note` never converts. */
export function transactionTypeFor(type: InboxType): TransactionType | null {
  if (type === 'to-pay') return 'expense';
  if (type === 'to-receive') return 'income';
  return null;
}

export interface InboxPrefill {
  type: TransactionType;
  amount: number;
  note: string;
  date: string;
}

/**
 * What the transaction form opens with.
 *
 * The date is *today*, not the item's due date. The due date is when the money
 * was supposed to move; recording the transaction means it just did, and
 * back-dating a payment to a date it was merely promised on would put it in
 * the wrong month's spending. The form leaves it editable for the case where
 * the user is catching up on something that really did happen last week.
 *
 * Wallet and category are deliberately absent: an inbox item cannot know
 * either, and guessing them is how money ends up in the wrong account.
 */
export function prefillFor(item: InboxItem, today = todayKey()): InboxPrefill | null {
  const type = transactionTypeFor(item.type);
  if (!type || !(item.amount > 0)) return null;
  return { type, amount: item.amount, note: item.text.trim(), date: today };
}

function round2(value: number): number {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}
