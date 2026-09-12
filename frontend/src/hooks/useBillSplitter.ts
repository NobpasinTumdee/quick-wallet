/**
 * Bill splits, and the two writes that reach beyond them into the ledger.
 *
 * ---------------------------------------------------------------------------
 * WHY CREATE AND MARK-PAID ARE NOT `useExcelDB` WRITES
 * ---------------------------------------------------------------------------
 * Both touch two resources at once. Creating a bill writes a BillSplits row
 * *and* an expense Transaction; settling a share writes an income Transaction
 * *and* flips a flag inside the bill. The generic optimistic helper in
 * `useExcelDB` only patches its own collection, so the Wallets and Activity
 * screens would sit stale for the second or two the Apps Script round trip
 * takes — and on this feature the wallet balance is precisely the number the
 * user is watching.
 *
 * So both go through one server handler that writes both halves under the
 * script lock, and the caches are patched here by hand and rolled back as one
 * unit on failure. That is the shape `useSubscriptions.pay` established, for
 * the same reason.
 *
 * The dashboard is deliberately *not* patched, only invalidated. Its payload
 * carries derived figures — net worth, savings rate, budget progress — computed
 * server-side; reimplementing those here to shave a second off one card is how
 * two sources of truth start disagreeing.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE LEDGER ENDS UP SAYING
 * ---------------------------------------------------------------------------
 *   create      expense, the FULL bill, out of the wallet
 *   each repay  income, that one share, back into the same wallet
 *
 * Over the bill's life the pair nets to the payer's own share, which is exactly
 * what they spent. The full amount is expensed up front on purpose: until
 * someone actually pays you back, you really are down the whole bill, and a
 * wallet balance that pretended otherwise would be wrong in the direction that
 * makes people overspend.
 */

import { useCallback, useMemo } from 'react';

import { mutateMatching, invalidate } from '../api/cache';
import { api } from '../api/client';
import { toast } from '../lib/toast';
import { CollectionState, useExcelDB } from './useExcelDB';
import {
  BillSplit,
  BillSplitResult,
  BillSplitUnpaidResult,
  Transaction,
  WalletBalance,
} from '../types';

/** Everything a bill write makes stale. */
const DERIVED = ['/api/bill-splits', '/api/transactions', '/api/wallets', '/api/budgets', '/api/dashboard'];

export interface CreateBillSplitInput {
  title: string;
  totalAmount: number;
  walletId: string;
  note?: string;
  /** `YYYY-MM-DD`. Defaults to today, server-side. */
  date?: string;
  /** The category for the expense row. Defaults to 'Shared'. */
  category?: string;
  splits: { personName: string; amount: number }[];
}

export interface BillSplitterState {
  /** Every bill, newest first. */
  bills: BillSplit[];
  /** Bills with somebody still owing. */
  open: BillSplit[];
  settled: BillSplit[];

  /** Owed to the user across every open bill. */
  totalOutstanding: number;
  /** Recovered across every bill. */
  totalRecovered: number;
  /** How many people, across all open bills, still owe something. */
  peopleOwing: number;

  /** Spending wallets a bill can be paid from. */
  payableFrom: WalletBalance[];

  initialLoading: boolean;
  isValidating: boolean;
  error: string | null;
  mutating: boolean;
  refresh: () => Promise<void>;

  create: (input: CreateBillSplitInput) => Promise<BillSplitResult>;
  /** Settles one share and books the money back in. Idempotent. */
  markPaid: (bill: BillSplit, index: number) => Promise<BillSplitResult>;
  /** Undoes a repayment, removing the income row it wrote. */
  markUnpaid: (bill: BillSplit, index: number) => Promise<BillSplitUnpaidResult>;
  remove: (bill: BillSplit, keepTransactions?: boolean) => Promise<void>;

  /** The underlying collection, for anything generic. */
  collection: CollectionState<BillSplit>;
}

export function useBillSplitter(): BillSplitterState {
  const collection = useExcelDB<BillSplit>('bill-splits');
  const wallets = useExcelDB<WalletBalance>('wallets');

  const bills = collection.items;

  const { open, settled, totalOutstanding, totalRecovered, peopleOwing } = useMemo(() => {
    const openBills: BillSplit[] = [];
    const settledBills: BillSplit[] = [];
    let outstanding = 0;
    let recovered = 0;
    let owing = 0;

    for (const bill of bills) {
      if (bill.status === 'settled') settledBills.push(bill);
      else openBills.push(bill);

      outstanding += Number(bill.outstanding) || 0;
      recovered += Number(bill.recovered) || 0;
      owing += (bill.splits ?? []).filter((s) => !s.isPaid).length;
    }

    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
    return {
      open: openBills,
      settled: settledBills,
      totalOutstanding: round2(outstanding),
      totalRecovered: round2(recovered),
      peopleOwing: owing,
    };
  }, [bills]);

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
   * Returns the rollback so a failed write can put it back exactly, rather than
   * leaving a refetch to eventually correct a number the user already saw.
   */
  const patchWallet = useCallback((walletId: string, delta: number, isIncome: boolean) => {
    return mutateMatching<WalletBalance[]>('/api/wallets', (rows) =>
      (rows ?? []).map((wallet) =>
        wallet.id === walletId
          ? {
              ...wallet,
              balance: wallet.balance + delta,
              income: isIncome ? wallet.income + Math.abs(delta) : wallet.income,
              expense: isIncome ? wallet.expense : wallet.expense + Math.abs(delta),
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

  const replaceBill = useCallback((bill: BillSplit) => {
    return mutateMatching<BillSplit[]>('/api/bill-splits', (rows) =>
      (rows ?? []).map((row) => (row.id === bill.id ? bill : row)),
    );
  }, []);

  /* ---------------------------------------------------------------- */
  /* Writes                                                            */
  /* ---------------------------------------------------------------- */

  const create = useCallback(
    async (input: CreateBillSplitInput) => {
      /* Not optimistic. The server decides the expense row's id, the bill's id
         and every derived figure on it, and a bill whose totals were guessed
         locally would flicker the moment the real one arrived. It is one round
         trip and the form stays open until it lands. */
      const result = await api.post<BillSplitResult>('/api/bill-splits', input);

      /* Belt and braces. A create that answers with anything but a bill means
         the request was routed somewhere else — which is exactly what used to
         happen, and the `undefined` it pushed into the cache took the whole
         render tree down on the next paint. Failing loudly here keeps the
         damage to one toast instead of a white screen. */
      if (!result?.billSplit?.id) {
        throw new Error('The server did not return the new bill');
      }

      mutateMatching<BillSplit[]>('/api/bill-splits', (rows) => [result.billSplit, ...(rows ?? [])]);
      if (result.transaction) {
        addTransaction(result.transaction);
        patchWallet(input.walletId, -result.transaction.amount, false);
      }
      invalidate(DERIVED);
      return result;
    },
    [addTransaction, patchWallet],
  );

  const markPaid = useCallback(
    async (bill: BillSplit, index: number) => {
      const share = bill.splits?.[index];
      if (!share) throw new Error('That person is not on this bill');

      /* Optimistic: this is the one control the user taps repeatedly, and a
         second of nothing happening after each tap is what makes a tracker
         feel broken. Every patch here is undone as one unit on failure. */
      const rollbacks: (() => void)[] = [];

      const nextSplits = bill.splits.map((s, i) =>
        i === index ? { ...s, isPaid: true } : s,
      );
      const recovered = nextSplits
        .filter((s) => s.isPaid)
        .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

      rollbacks.push(
        replaceBill({
          ...bill,
          splits: nextSplits,
          recovered,
          outstanding: bill.owedTotal - recovered,
          recoveredPercent: bill.owedTotal > 0 ? (recovered / bill.owedTotal) * 100 : 100,
          status: nextSplits.every((s) => s.isPaid) ? 'settled' : 'open',
        }),
      );
      rollbacks.push(patchWallet(bill.walletId, share.amount, true));

      try {
        const result = await api.post<BillSplitResult>(
          `/api/bill-splits/${bill.id}/mark-paid`,
          { index },
        );

        /* The server is the authority on what actually happened — including
           "nothing", when the share was already settled by another tab. */
        if (!result?.billSplit?.id) throw new Error('The server did not return the updated bill');
        replaceBill(result.billSplit);
        if (result.transaction) addTransaction(result.transaction);
        else if (result.alreadyPaid) {
          // Undo the balance patch: no money moved this time.
          rollbacks[1]();
        }

        invalidate(DERIVED);
        return result;
      } catch (err) {
        rollbacks.forEach((undo) => undo());
        toast.error(err instanceof Error ? err.message : 'Could not record the payment');
        throw err;
      }
    },
    [replaceBill, patchWallet, addTransaction],
  );

  const markUnpaid = useCallback(
    async (bill: BillSplit, index: number) => {
      const share = bill.splits?.[index];
      if (!share) throw new Error('That person is not on this bill');

      const result = await api.post<BillSplitUnpaidResult>(
        `/api/bill-splits/${bill.id}/mark-unpaid`,
        { index },
      );

      if (!result?.billSplit?.id) throw new Error('The server did not return the updated bill');
      replaceBill(result.billSplit);
      if (result.removedTransactionId) {
        mutateMatching<Transaction[]>('/api/transactions', (rows) =>
          (rows ?? []).filter((row) => row.id !== result.removedTransactionId),
        );
        patchWallet(bill.walletId, -share.amount, true);
      }
      invalidate(DERIVED);
      return result;
    },
    [replaceBill, patchWallet],
  );

  const remove = useCallback(
    async (bill: BillSplit, keepTransactions = false) => {
      await api.delete<{ ok: boolean; removedTransactions: number }>(
        `/api/bill-splits/${bill.id}`,
        { keepTransactions },
      );

      mutateMatching<BillSplit[]>('/api/bill-splits', (rows) =>
        (rows ?? []).filter((row) => row.id !== bill.id),
      );

      if (!keepTransactions) {
        const removedIds = new Set(
          [bill.expenseTxId, ...(bill.splits ?? []).map((s) => s.repaymentTxId)].filter(Boolean),
        );
        mutateMatching<Transaction[]>('/api/transactions', (rows) =>
          (rows ?? []).filter((row) => !removedIds.has(row.id)),
        );
      }

      // Balances are the sum of many rows here rather than one delta, so they
      // are refetched rather than reconstructed.
      invalidate(DERIVED);
      await wallets.refresh();
    },
    [wallets],
  );

  const refresh = useCallback(async () => {
    await Promise.all([collection.refresh(), wallets.refresh()]);
  }, [collection, wallets]);

  return {
    bills,
    open,
    settled,
    totalOutstanding,
    totalRecovered,
    peopleOwing,
    payableFrom,
    initialLoading: collection.initialLoading || wallets.initialLoading,
    isValidating: collection.isValidating || wallets.isValidating,
    error: collection.error ?? wallets.error,
    mutating: collection.mutating || wallets.mutating,
    refresh,
    create,
    markPaid,
    markUnpaid,
    remove,
    collection,
  };
}
