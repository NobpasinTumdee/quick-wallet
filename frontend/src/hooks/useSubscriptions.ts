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
import { advanceDueDate } from '../lib/recurrence';
import { BillSplit, Subscription, SubscriptionPayment, Transaction, WalletBalance } from '../types';

/* Re-exported so the call sites that reach for it here keep working; the
   implementation moved to `lib/recurrence` when the liability heatmap needed to
   project bills without pulling in React. */
export { advanceDueDate };

/** Today as `YYYY-MM-DD`, in local time — the same clock the user reads. */
export function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export interface SubscriptionsState extends CollectionState<Subscription> {
  /**
   * Writes the expense and rolls the cycle. Optimistic across four caches.
   *
   * Answers with the server's own result so the caller can say what happened:
   * a shared subscription also comes back carrying the bill it raised, or the
   * reason it could not be raised.
   */
  pay: (subscription: Subscription) => Promise<SubscriptionPayment>;
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
        // A subscription payment is never part of an installment plan; spelled
        // out rather than left off so the draft is the same shape as the row
        // the server sends back to replace it.
        installmentGroupId: '',
        installmentIndex: '',
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

        /* A shared subscription also raised a bill. Pushed into the cache the
           same way the transaction is, so the Shared Expenses screen has it
           without a refetch — and, crucially, *not* accompanied by a second
           wallet patch: the bill points at the expense that was already booked
           above, so the money left the wallet exactly once. */
        if (saved?.billSplit) {
          mutateMatching<BillSplit[]>('/api/bill-splits', (rows) => [
            saved.billSplit as BillSplit,
            ...(rows ?? []).filter((row) => row.id !== saved.billSplit?.id),
          ]);
        }

        return saved;
      } catch (error) {
        undoAll();
        throw error;
      }
    },
    [collection],
  );

  return { ...collection, pay };
}
