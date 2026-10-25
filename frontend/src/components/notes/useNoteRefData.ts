import { useMemo } from 'react';

import { useExcelDB, useExcelQuery } from '../../hooks/useExcelDB';
import { formatDayMonth } from '../../lib/format';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';
import { BillSplit, Goal, NoteRefType, Subscription, Transaction, WalletBalance } from '../../types';

/**
 * Turns `{ type, id }` into something a person can read.
 *
 * Each list is fetched only when something needs it — the picker's open tab,
 * or a chip of that kind on screen — and with the same params the rest of the
 * app uses, so it shares their cache instead of fetching a second copy:
 * `/api/wallets?includeArchived=true` is what the Wallets page holds, and
 * `/api/transactions?limit=2000` what Cards and Analytics warm.
 */

/** Activity rows looked up in one request. Older ones are fetched one by one. */
export const ACTIVITY_LIMIT = 2000;

export interface RefOption {
  type: NoteRefType;
  id: string;
  /** The main line. */
  label: string;
  /** A quieter second line: an amount, a date. */
  detail: string;
}

export interface RefList {
  options: RefOption[];
  loading: boolean;
  error: boolean;
}

export function useRefDescriber() {
  const money = useMoneyFormatter();
  const { settings } = useSettings();

  return useMemo(
    () => ({
      transaction: (tx: Transaction): RefOption => ({
        type: 'transaction',
        id: tx.id,
        label: tx.note.trim() || tx.category || tx.type,
        detail: [formatDayMonth(tx.date, settings.locale), tx.note.trim() ? tx.category : '', money(tx.amount)]
          .filter(Boolean)
          .join(' · '),
      }),
      wallet: (wallet: WalletBalance): RefOption => ({
        type: 'wallet',
        id: wallet.id,
        label: wallet.name,
        detail: money(wallet.balance),
      }),
      goal: (goal: Goal): RefOption => ({
        type: 'goal',
        id: goal.id,
        label: goal.title,
        detail: money(goal.targetAmount),
      }),
      subscription: (sub: Subscription): RefOption => ({
        type: 'subscription',
        id: sub.id,
        label: sub.name,
        detail: money(sub.amount),
      }),
      split: (bill: BillSplit): RefOption => ({
        type: 'split',
        id: bill.id,
        label: bill.title,
        detail: money(bill.totalAmount),
      }),
    }),
    [money, settings.locale],
  );
}

/** Every list a note can point into, each enabled on demand. */
export function useRefLists(wanted: ReadonlySet<NoteRefType>): Record<NoteRefType, RefList> {
  const describe = useRefDescriber();

  const transactions = useExcelDB<Transaction>(
    'transactions',
    { limit: ACTIVITY_LIMIT },
    { enabled: wanted.has('transaction') },
  );
  const wallets = useExcelDB<WalletBalance>(
    'wallets',
    { includeArchived: true },
    { enabled: wanted.has('wallet') },
  );
  const goals = useExcelDB<Goal>('goals', undefined, { enabled: wanted.has('goal') });
  const subscriptions = useExcelDB<Subscription>('subscriptions', undefined, {
    enabled: wanted.has('subscription'),
  });
  const splits = useExcelDB<BillSplit>('bill-splits', undefined, { enabled: wanted.has('split') });

  return useMemo(() => {
    const list = <T,>(state: { items: T[]; initialLoading: boolean; error: string | null }, map: (row: T) => RefOption): RefList => ({
      options: state.items.map(map),
      loading: state.initialLoading,
      error: state.error !== null && state.items.length === 0,
    });
    return {
      transaction: list(transactions, describe.transaction),
      wallet: list(wallets, describe.wallet),
      goal: list(goals, describe.goal),
      subscription: list(subscriptions, describe.subscription),
      split: list(splits, describe.split),
    };
  }, [transactions, wallets, goals, subscriptions, splits, describe]);
}

/**
 * One Activity row by id — for a reference older than the latest
 * `ACTIVITY_LIMIT`, which the shared list does not reach. Only enabled when
 * the list has loaded and genuinely lacks it.
 */
export function useSingleTransaction(id: string, enabled: boolean) {
  const describe = useRefDescriber();
  const query = useExcelQuery<Transaction>(`/api/transactions/${encodeURIComponent(id)}`, undefined, {
    enabled,
  });
  return {
    option: query.data ? describe.transaction(query.data) : null,
    loading: enabled && query.initialLoading,
    missing: query.errorCode === 'NOT_FOUND',
    error: query.error !== null && query.errorCode !== 'NOT_FOUND',
  };
}
