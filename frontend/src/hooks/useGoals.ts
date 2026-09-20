import { useCallback } from 'react';

import { mutateMatching, refreshPrefixes } from '../api/cache';
import { api } from '../api/client';
import { CollectionState, useExcelDB } from './useExcelDB';
import { Goal, GoalPurchaseResult, Transaction, WalletBalance } from '../types';

/**
 * Sinking funds.
 *
 * A thin wrapper over `useExcelDB`, plus the two operations that cannot be a
 * plain update: funding, and buying the thing.
 */
export interface GoalsState extends CollectionState<Goal> {
  /**
   * Moves `amount` into or out of a goal. Negative withdraws.
   *
   * -----------------------------------------------------------------------
   * WHY THIS SENDS A DELTA AND NOT A NEW BALANCE
   * -----------------------------------------------------------------------
   * The obvious client-side version reads `savedAmount`, adds to it, and PATCHes
   * the result. Two tabs — or a phone and a laptop — each read 1,000, each write
   * 1,500, and one of the two deposits disappears with no error anywhere.
   *
   * So the server takes the delta and resolves it against the row as it actually
   * is, under the script lock. The optimistic patch here still has to guess, but
   * it is only ever a guess: the reconcile step overwrites it with the row the
   * server computed, so a concurrent write corrects itself on the next tick
   * instead of being silently lost.
   */
  fund: (goal: Goal, amount: number) => Promise<Goal>;

  /**
   * Buys the thing: one server call that writes the expense against `walletId`
   * and marks the goal purchased.
   *
   * Rejects if the goal is unknown locally, so a mistyped id fails here rather
   * than arriving at the server as a request to spend money on nothing.
   */
  purchase: (goalId: string, walletId: string, options?: PurchaseOptions) => Promise<GoalPurchaseResult>;
}

export interface PurchaseOptions {
  /** Defaults to today, server-side. */
  date?: string;
  /** Defaults to "Goal"; override to land the expense in a real budget. */
  category?: string;
  /** Defaults to `Goal: {title}`. */
  note?: string;
}

export function useGoals(): GoalsState {
  const collection = useExcelDB<Goal>('goals');
  const { action, items } = collection;

  const fund = useCallback(
    (goal: Goal, amount: number) => action<Goal>(goal.id, 'fund', { amount }),
    [action],
  );

  /**
   * ---------------------------------------------------------------------
   * WHY PURCHASE IS HAND-WRITTEN RATHER THAN `action(id, 'purchase')`
   * ---------------------------------------------------------------------
   * Two reasons, and the second is the one that would bite.
   *
   * `action` merges the whole response into the goal row, and this endpoint
   * answers `{ ok, goal, transaction, shortfall }` — merging that would put an
   * `ok` and a nested `transaction` onto a Goal and leave every real field
   * untouched, so the card would never change.
   *
   * And a purchase is the one goals write that moves real money: the paying
   * wallet drops, an expense appears on Activity, and the month's spending
   * rises. `useExcelDB` only ever patches its own collection, so those screens
   * would sit visibly stale for the 1–3s round trip. The patch is applied by
   * hand across every cached copy instead, and rolled back as one unit if the
   * write fails — the same shape `useDebtManager.pay` uses.
   */
  const purchase = useCallback(
    async (goalId: string, walletId: string, options: PurchaseOptions = {}) => {
      const goal = items.find((row) => row.id === goalId);
      if (!goal) throw new Error('Goal not found');
      if (!walletId) throw new Error('Choose a wallet to pay from');

      const price = Math.round((Number(goal.targetAmount) || 0) * 100) / 100;
      if (!(price > 0)) throw new Error('This goal has no price to pay');

      /* Optimistic on the wallet only — arithmetic this client can do exactly.
         The goal row is left alone until the server answers: `status`,
         `purchasedAt` and `purchaseTxId` are decided there, and a locally
         invented set of them would flicker the moment the real row landed. */
      const undoWallet = mutateMatching<WalletBalance[]>('/api/wallets', (rows) =>
        (rows ?? []).map((wallet) =>
          wallet.id === walletId
            ? {
                ...wallet,
                balance: wallet.balance - price,
                expense: wallet.expense + price,
                transactionCount: wallet.transactionCount + 1,
              }
            : wallet,
        ),
      );

      try {
        const result = await api.post<GoalPurchaseResult>(`/api/goals/${goalId}/purchase`, {
          walletId,
          date: options.date,
          category: options.category,
          note: options.note,
        });

        /* Belt and braces: a malformed answer must not put `undefined` into the
           cache, where it crashes the next render rather than the request. */
        if (!result?.goal || !result?.transaction) {
          throw new Error('The server did not return the purchase');
        }

        mutateMatching<Goal[]>('/api/goals', (rows) =>
          (rows ?? []).map((row) => (row.id === goalId ? result.goal : row)),
        );
        mutateMatching<Transaction[]>('/api/transactions', (rows) =>
          [result.transaction, ...(rows ?? [])].sort((a, b) =>
            `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`),
          ),
        );

        /* Budgets and the dashboard are derived server-side from the row that
           just landed, so they are refetched rather than guessed. */
        await refreshPrefixes(['/api/budgets', '/api/dashboard']);

        return result;
      } catch (error) {
        undoWallet();
        throw error;
      }
    },
    [items],
  );

  return { ...collection, fund, purchase };
}
