/**
 * Credit cards: the wallets, their derived billing state, and the two writes
 * that are specific to them.
 *
 * ---------------------------------------------------------------------------
 * WHY IT COMPOSES TWO EXISTING COLLECTIONS RATHER THAN ADDING AN ENDPOINT
 * ---------------------------------------------------------------------------
 * A card's state is a pure function of a wallet row and the ledger, both of
 * which the app already fetches and caches. A `cards.list` endpoint would be a
 * third copy of the same data that goes stale the instant an optimistic write
 * lands — the cache would be holding a brand new charge next to a statement
 * balance computed before it existed. Deriving instead means a charge added on
 * the Activity screen moves the card's figures on this screen with no round
 * trip at all.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LEDGER IS FETCHED UNSCOPED
 * ---------------------------------------------------------------------------
 * Every other screen scopes transactions to a month. A card cannot: its
 * statement straddles a month boundary, its balance is the sum of everything
 * ever charged and paid, and an installment plan reaches up to five years into
 * the future. So this asks for a deliberately generous window.
 *
 * The cost is one extra cache key, and `mutateMatching` patches by key prefix,
 * so writes made anywhere in the app still reach it.
 */

import { useCallback, useMemo } from 'react';

import { mutateMatching } from '../api/cache';
import { api } from '../api/client';
import {
  CardState,
  DebtSummary,
  computeCardState,
  summarizeDebt,
} from '../lib/creditMath';
import { todayKey } from '../lib/format';
import { CollectionState, useExcelDB } from './useExcelDB';
import { InstallmentPlanResult, Transaction, WalletBalance } from '../types';

/**
 * Enough rows to cover a real ledger plus a five-year plan. The server caps at
 * 5000; asking for that would make every card view pay for history nobody has.
 */
const LEDGER_LIMIT = 2000;

export interface PayBillInput {
  /** The card being paid. */
  card: CardState;
  /** A CASH wallet to pay from. */
  fromWalletId: string;
  amount: number;
  /** Defaults to today. */
  date?: string;
  note?: string;
}

export interface InstallmentInput {
  /** The card the purchase goes on. Plans only make sense on credit. */
  walletId: string;
  /** The full purchase price, not the monthly figure. */
  amount: number;
  months: number;
  category: string;
  note: string;
  /** First chunk's date; the rest follow monthly. Defaults to today. */
  date?: string;
}

export interface CreditCardsState {
  /** One entry per non-archived credit wallet, biggest statement first. */
  cards: CardState[];
  /** Every credit wallet including archived ones, for lookups by id. */
  allCards: CardState[];
  summary: DebtSummary;
  /** CASH spending wallets — what a bill can be paid from. */
  payableFrom: WalletBalance[];

  initialLoading: boolean;
  isValidating: boolean;
  error: string | null;
  refresh: () => Promise<void>;

  /** True while a card write is settling. */
  mutating: boolean;

  /**
   * Pays a card bill as an ordinary transfer.
   *
   * There is no new row type and no new endpoint because there does not need to
   * be one: a transfer out of a cash wallet and into the card is exactly the
   * movement, and because transfers are excluded from income and expense totals
   * everywhere in the app, the payment cannot double-count as spending.
   */
  payBill: (input: PayBillInput) => Promise<Transaction>;

  /** Writes an n-month 0% plan as n dated rows. See Code.gs for why. */
  createInstallment: (input: InstallmentInput) => Promise<InstallmentPlanResult>;

  /** Removes every chunk of a plan in one call. */
  cancelInstallment: (groupId: string) => Promise<void>;

  /** The underlying wallets collection, for edit/archive/delete. */
  wallets: CollectionState<WalletBalance>;
}

export function useCreditCards(today = todayKey()): CreditCardsState {
  const wallets = useExcelDB<WalletBalance>('wallets', { includeArchived: true });
  const ledger = useExcelDB<Transaction>('transactions', { limit: LEDGER_LIMIT });

  const allCards = useMemo(() => {
    const cards = wallets.items.filter((w) => w.type === 'CREDIT' && w.mode === 'expense');
    return cards
      .map((wallet) => computeCardState(wallet, ledger.items, today))
      .sort(
        (a, b) =>
          // Anything demanding money first, then by how much is owed. A card
          // with a due date this week has to be the one you see without
          // scrolling, whatever its balance.
          Number(b.overdue) - Number(a.overdue) ||
          Number(b.dueSoon) - Number(a.dueSoon) ||
          b.currentBalance - a.currentBalance,
      );
  }, [wallets.items, ledger.items, today]);

  const cards = useMemo(() => allCards.filter((card) => !card.wallet.archived), [allCards]);
  const summary = useMemo(() => summarizeDebt(cards), [cards]);

  const payableFrom = useMemo(
    () =>
      wallets.items.filter((w) => !w.archived && w.mode === 'expense' && w.type !== 'CREDIT'),
    [wallets.items],
  );

  /* ---------------------------------------------------------------- */
  /* Pay bill                                                          */
  /* ---------------------------------------------------------------- */

  const payBill = useCallback(
    async ({ card, fromWalletId, amount, date, note }: PayBillInput) => {
      const value = Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
      if (!(value > 0)) throw new Error('Enter an amount greater than zero');
      if (!fromWalletId) throw new Error('Choose a wallet to pay from');

      const payload = {
        type: 'transfer' as const,
        walletId: fromWalletId,
        toWalletId: card.wallet.id,
        amount: value,
        category: 'Transfer',
        note: note?.trim() || `${card.wallet.name} bill payment`,
        date: date || today,
      };

      /* Patch the wallet balances by hand, the way useSubscriptions.pay does.
         `create` below already invalidates /api/wallets, but that is a refetch:
         without this the card the user just paid would keep showing the old
         balance for the second or two the Apps Script round trip takes, which
         on this screen is the one number they are watching. */
      const rollback = mutateMatching<WalletBalance[]>('/api/wallets', (rows) =>
        (rows ?? []).map((wallet) => {
          if (wallet.id === fromWalletId) {
            // Exactly what computeWalletBalances_ does for a transfer out.
            return {
              ...wallet,
              balance: wallet.balance - value,
              transactionCount: wallet.transactionCount + 1,
            };
          }
          if (wallet.id === card.wallet.id) {
            return {
              ...wallet,
              balance: wallet.balance + value,
              transactionCount: wallet.transactionCount + 1,
            };
          }
          return wallet;
        }),
      );

      try {
        // Through the collection so its invalidate list and error toast run.
        return await ledger.create(payload);
      } catch (error) {
        rollback();
        throw error;
      }
    },
    [ledger, today],
  );

  /* ---------------------------------------------------------------- */
  /* Installments                                                      */
  /* ---------------------------------------------------------------- */

  const createInstallment = useCallback(
    async ({ walletId, amount, months, category, note, date }: InstallmentInput) => {
      const result = await api.post<InstallmentPlanResult>('/api/transactions/installment', {
        walletId,
        amount,
        months,
        category,
        note,
        date: date || today,
      });

      /* The server owns the split — it decides where the rounding remainder
         lands and how each chunk's date clamps in a short month — so the rows
         it returns are written into the cache rather than guessed at first and
         reconciled after. n rows appearing at once is not a case the generic
         optimistic helper in useExcelDB models. */
      mutateMatching<Transaction[]>('/api/transactions', (rows) =>
        [...result.transactions, ...(rows ?? [])].sort((a, b) =>
          `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`),
        ),
      );

      mutateMatching<WalletBalance[]>('/api/wallets', (rows) =>
        (rows ?? []).map((wallet) =>
          wallet.id === walletId
            ? {
                ...wallet,
                // The full purchase, not one chunk: the balance sums every row
                // regardless of date, which is what makes the card show the
                // whole amount still owed to the bank from day one.
                balance: wallet.balance - result.total,
                transactionCount: wallet.transactionCount + result.months,
              }
            : wallet,
        ),
      );

      await Promise.all([wallets.refresh(), ledger.refresh()]);
      return result;
    },
    [wallets, ledger, today],
  );

  const cancelInstallment = useCallback(
    async (groupId: string) => {
      await api.delete<{ ok: boolean; removed: number }>('/api/transactions/cancel-installment', {
        groupId,
      });
      mutateMatching<Transaction[]>('/api/transactions', (rows) =>
        (rows ?? []).filter((row) => row.installmentGroupId !== groupId),
      );
      await Promise.all([wallets.refresh(), ledger.refresh()]);
    },
    [wallets, ledger],
  );

  const refresh = useCallback(async () => {
    await Promise.all([wallets.refresh(), ledger.refresh()]);
  }, [wallets, ledger]);

  return {
    cards,
    allCards,
    summary,
    payableFrom,
    // Both feed every figure on the screen, so either one missing is a skeleton.
    initialLoading: wallets.initialLoading || ledger.initialLoading,
    isValidating: wallets.isValidating || ledger.isValidating,
    error: wallets.error ?? ledger.error,
    refresh,
    mutating: wallets.mutating || ledger.mutating,
    payBill,
    createInstallment,
    cancelInstallment,
    wallets,
  };
}

/**
 * One card's state by wallet id, or null.
 *
 * Kept beside the list hook rather than re-deriving in a component so a detail
 * view and the card grid can never disagree about what is owed.
 */
export function useCreditCard(walletId: string | undefined): CardState | null {
  const { allCards } = useCreditCards();
  return useMemo(
    () => (walletId ? allCards.find((card) => card.wallet.id === walletId) ?? null : null),
    [allCards, walletId],
  );
}
