import { useCallback, useMemo } from 'react';

import { mutateMatching, refreshPrefixes } from '../api/cache';
import { api } from '../api/client';
import { CollectionState, useExcelDB } from './useExcelDB';
import { DebtSummary, debtSummary } from '../lib/debtMath';
import { Debt, DebtPaymentResult, Transaction, WalletBalance } from '../types';

/**
 * Debts, and the one write that moves real money.
 *
 * ---------------------------------------------------------------------------
 * WHY PAY IS HAND-WRITTEN RATHER THAN A GENERIC ACTION
 * ---------------------------------------------------------------------------
 * The same reason `subscriptions.pay` is. Paying a debt touches four things at
 * once: the debt's balance falls, a Transaction appears, the paying wallet
 * drops, and the month's expense total rises. `useExcelDB`'s optimistic helper
 * only patches its own collection, so the Wallets and Activity screens would
 * sit visibly stale for the 1–3s the Apps Script round trip takes — on a screen
 * whose entire purpose is telling you money left your account.
 *
 * So the patch is applied by hand across every cached copy and rolled back as
 * one unit if the write fails.
 *
 * The dashboard is deliberately not patched, only invalidated. Its payload
 * carries figures derived server-side — net worth, savings rate, budget
 * progress — and reimplementing those formulas here to save a second is how two
 * sources of truth start disagreeing.
 */

export interface PayDebtInput {
  debt: Debt;
  /** A spending wallet. The server refuses investment wallets. */
  walletId: string;
  amount: number;
  /** Defaults to today, server-side. */
  date?: string;
  category?: string;
  note?: string;
}

export interface DebtManagerState extends Omit<CollectionState<Debt>, 'items'> {
  /** Every debt, costliest first, settled ones last. */
  debts: Debt[];
  active: Debt[];
  settled: Debt[];
  summary: DebtSummary;

  /** Spending wallets a payment can come from. Investment wallets excluded. */
  payableFrom: WalletBalance[];

  /** Writes the expense and lowers the balance, in one server call. */
  pay: (input: PayDebtInput) => Promise<DebtPaymentResult>;

  /** The underlying collection, for create/update/delete. */
  collection: CollectionState<Debt>;
}

export function useDebtManager(): DebtManagerState {
  const collection = useExcelDB<Debt>('debts');
  const wallets = useExcelDB<WalletBalance>('wallets');

  const debts = collection.items;

  const { active, settled } = useMemo(() => {
    const activeDebts: Debt[] = [];
    const settledDebts: Debt[] = [];
    for (const debt of debts) {
      if (debt.settled || debt.currentBalance <= 0) settledDebts.push(debt);
      else activeDebts.push(debt);
    }
    return { active: activeDebts, settled: settledDebts };
  }, [debts]);

  const summary = useMemo(() => debtSummary(debts), [debts]);

  /* A debt is settled with real cash, so a brokerage account is not an option —
     the server refuses `mode: 'investment'` outright, and offering it here would
     only let the user pick something that comes back as an error. */
  const payableFrom = useMemo(
    () => wallets.items.filter((w) => !w.archived && w.mode === 'expense'),
    [wallets.items],
  );

  /* ---------------------------------------------------------------- */
  /* Cache patching                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Moves a wallet's balance the way `computeWalletBalances_` would.
   *
   * Returns the rollback so a failed write puts it back exactly, rather than
   * leaving a refetch to eventually correct a number the user already read.
   */
  const patchWallet = useCallback((walletId: string, amount: number) => {
    return mutateMatching<WalletBalance[]>('/api/wallets', (rows) =>
      (rows ?? []).map((wallet) =>
        wallet.id === walletId
          ? {
              ...wallet,
              balance: wallet.balance - amount,
              expense: wallet.expense + amount,
              transactionCount: wallet.transactionCount + 1,
            }
          : wallet,
      ),
    );
  }, []);

  const addTransaction = useCallback((tx: Transaction) => {
    return mutateMatching<Transaction[]>('/api/transactions', (rows) =>
      [tx, ...(rows ?? [])].sort((a, b) =>
        `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`),
      ),
    );
  }, []);

  const replaceDebt = useCallback((debt: Debt) => {
    return mutateMatching<Debt[]>('/api/debts', (rows) =>
      (rows ?? []).map((row) => (row.id === debt.id ? debt : row)),
    );
  }, []);

  /* ---------------------------------------------------------------- */
  /* Pay                                                               */
  /* ---------------------------------------------------------------- */

  const pay = useCallback(
    async ({ debt, walletId, amount, date, category, note }: PayDebtInput) => {
      const payment = Math.round((Number(amount) || 0) * 100) / 100;
      if (!(payment > 0)) throw new Error('Payment must be greater than zero');

      /* Optimistic on the wallet only.

         The debt row itself is left alone until the server answers, which is a
         deliberate asymmetry. A wallet balance is arithmetic this client can do
         exactly — subtract the payment — so guessing it is safe. The debt's
         figures are not: `percentPaid`, `projectedMonthlyInterest` and
         `settled` are all computed in `decorateDebt_`, and a locally invented
         set of them would flicker the moment the real row landed. One second of
         an unchanged balance beats a number that visibly corrects itself. */
      const undoWallet = patchWallet(walletId, payment);

      try {
        const result = await api.post<DebtPaymentResult>(`/api/debts/${debt.id}/pay`, {
          amount: payment,
          walletId,
          date,
          category,
          note,
        });

        /* Belt and braces: a malformed answer must not put `undefined` into the
           cache, where it crashes the next render rather than the request. */
        if (!result?.debt || !result?.transaction) {
          throw new Error('The server did not return the payment');
        }

        replaceDebt(result.debt);
        addTransaction(result.transaction);

        /* Budgets and the dashboard are derived server-side from the row that
           just landed, so they are refetched rather than guessed. */
        await refreshPrefixes(['/api/budgets', '/api/dashboard']);

        return result;
      } catch (error) {
        undoWallet();
        throw error;
      }
    },
    [patchWallet, replaceDebt, addTransaction],
  );

  return {
    ...collection,
    debts,
    active,
    settled,
    summary,
    payableFrom,
    pay,
    collection,
  };
}
