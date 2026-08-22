/**
 * Subscriptions, plus the optimistic "confirm payment" flow.
 *
 * ---------------------------------------------------------------------------
 * WHY PAY IS HAND-WRITTEN RATHER THAN JUST `action(id, 'pay')`
 * ---------------------------------------------------------------------------
 * Paying a subscription is the only write in this app that touches four
 * resources at once: the subscription rolls forward, a Transaction appears,
 * the wallet balance drops, and the month's expense total rises. The generic
 * optimistic helper in `useExcelDB` only patches its own collection, so the
 * Wallets and Activity screens would sit stale for the 1–3s the Apps Script
 * round trip takes.
 *
 * So the patch is applied by hand across every cached copy, and rolled back as
 * one unit if the write fails.
 *
 * The dashboard is deliberately NOT patched. Its payload carries derived
 * figures — net worth, savings rate, budget progress — computed by
 * `computeWalletBalances_` and friends on the server. Reimplementing those
 * formulas here to shave a second off one card is how two sources of truth
 * start disagreeing. It is invalidated instead, so it refetches and stays
 * authoritative.
 */

import { useCallback } from 'react';

import { mutateMatching } from '../api/cache';
import { CollectionState, useExcelDB } from '../hooks/useExcelDB';
import { Subscription, SubscriptionPayment, Transaction, WalletBalance } from '../types';

/** Mirrors `advanceDueDate_` in Code.gs — see the note there about month ends. */
export function advanceDueDate(dateKey: string, frequency: Subscription['frequency']): string {
  const [year, month, day] = String(dateKey ?? '').split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return dateKey;

  const toKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

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

/** Today as `YYYY-MM-DD`, in local time — the same clock the user reads. */
export function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export interface SubscriptionsState extends CollectionState<Subscription> {
  /** Writes the expense and rolls the cycle. Optimistic across four caches. */
  pay: (subscription: Subscription) => Promise<void>;
}

export function useSubscriptions(): SubscriptionsState {
  const collection = useExcelDB<Subscription>('subscriptions');

  const pay = useCallback(
    async (subscription: Subscription) => {
      const paidOn = todayKey();
      const nextDue = advanceDueDate(subscription.nextDueDate, subscription.frequency);
      const amount = Number(subscription.amount) || 0;

      // A placeholder id, replaced by the server's row on reconcile. Same
      // `optimistic:` convention the rest of the app uses, so `isOptimistic()`
      // renders it as pending.
      const draftId = `optimistic:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const draft: Transaction = {
        id: draftId,
        userId: subscription.userId,
        walletId: subscription.walletId,
        toWalletId: '',
        type: 'expense',
        amount,
        category: subscription.category,
        note: subscription.name,
        date: paidOn,
        createdAt: new Date().toISOString(),
      };

      /* ---- apply, collecting rollbacks so failure undoes all of it ---- */
      const rollbacks: (() => void)[] = [];

      rollbacks.push(
        mutateMatching<Subscription[]>('/api/subscriptions', (rows) =>
          (rows ?? [])
            .map((row) => (row.id === subscription.id ? { ...row, nextDueDate: nextDue } : row))
            .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate)),
        ),
      );

      rollbacks.push(
        mutateMatching<Transaction[]>('/api/transactions', (rows) => [draft, ...(rows ?? [])]),
      );

      rollbacks.push(
        mutateMatching<WalletBalance[]>('/api/wallets', (rows) =>
          (rows ?? []).map((wallet) =>
            wallet.id === subscription.walletId
              ? {
                  ...wallet,
                  // Exactly what computeWalletBalances_ does for an expense:
                  // balance down, expense up, one more transaction counted.
                  balance: wallet.balance - amount,
                  expense: wallet.expense + amount,
                  transactionCount: wallet.transactionCount + 1,
                }
              : wallet,
          ),
        ),
      );

      const undoAll = () => rollbacks.forEach((undo) => undo());

      try {
        // Goes through the collection's `action`, so its invalidate list (which
        // includes the dashboard and budgets) runs on success and its error
        // toast fires on failure.
        const saved = await collection.action<SubscriptionPayment>(subscription.id, 'pay', {
          date: paidOn,
        });

        // Reconcile against what the server actually decided, rather than
        // trusting the local guess — its date maths is the authority.
        if (saved?.subscription) {
          mutateMatching<Subscription[]>('/api/subscriptions', (rows) =>
            (rows ?? [])
              .map((row) => (row.id === subscription.id ? saved.subscription : row))
              .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate)),
          );
        }
        if (saved?.transaction) {
          mutateMatching<Transaction[]>('/api/transactions', (rows) =>
            (rows ?? []).map((row) => (row.id === draftId ? saved.transaction : row)),
          );
        }
      } catch (error) {
        undoAll();
        throw error;
      }
    },
    [collection],
  );

  return { ...collection, pay };
}
