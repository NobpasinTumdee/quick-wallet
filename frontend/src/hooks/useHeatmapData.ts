import { useMemo } from 'react';

import { useBillSplitter } from './useBillSplitter';
import { useCreditCards } from './useCreditCards';
import { useDebtManager } from './useDebtManager';
import { useExcelDB } from './useExcelDB';
import { todayKey } from '../lib/format';
import {
  CardBill,
  LiabilityMonth,
  LiabilityYear,
  buildLiabilityMonth,
  buildLiabilityYear,
  yearWindow,
} from '../lib/liabilityMath';
import { Subscription, Transaction } from '../types';

/**
 * Everything falling due, over one month or one year ahead.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ARITHMETIC IS NOT IN HERE
 * ---------------------------------------------------------------------------
 * This hook fetches and delegates. The projection — walking a weekly bill 52
 * times, amortising a debt until it clears, the month-end clamp, the level
 * thresholds — lives in `lib/liabilityMath` as pure functions, so it can be
 * tested against a table of dates rather than a rendered component. Everything
 * interesting about this feature is in that file; this one is plumbing and is
 * meant to stay boring.
 *
 * ---------------------------------------------------------------------------
 * WHY A YEAR COSTS NO EXTRA REQUESTS
 * ---------------------------------------------------------------------------
 * Worth stating, because it is why the toggle can be instant. Every source the
 * year needs is already in hand for the month: subscriptions, debts and bill
 * splits are small unscoped collections, and the installment rows come out of
 * the same unscoped ledger `useCreditCards` already fetches for statement
 * balances — requested here with identical params, so it is the same cache
 * entry and not a second call.
 *
 * The projection is the only real cost, and it is memoised on its inputs. A
 * year is ~365 buckets over a few hundred occurrences, which is microseconds;
 * what would hurt is recomputing that on every render, which the memos prevent.
 */

/** Months ahead. Only the two the toggle offers. */
export type HeatmapRange = 1 | 12;

/**
 * Enough rows for a real ledger plus a five-year installment plan.
 *
 * Deliberately the same figure `useCreditCards` uses: `useExcelDB` keys its
 * cache on the params, so an identical request is served from the entry that
 * hook already populated. A different limit here would silently double the
 * ledger traffic on every screen showing the heatmap.
 */
const LEDGER_LIMIT = 2000;

export interface HeatmapData extends LiabilityMonth {
  initialLoading: boolean;
  isValidating: boolean;
  /** True when nothing at all falls due — the empty state, not an error. */
  isEmpty: boolean;
  /** Built only when `months` is 12; null on the month view. */
  year: LiabilityYear | null;
}

export function useHeatmapData(
  period: string,
  options: { paydays?: number[] | null; today?: string; months?: HeatmapRange } = {},
): HeatmapData {
  const subscriptions = useExcelDB<Subscription>('subscriptions');
  const cards = useCreditCards();
  const splitter = useBillSplitter();
  const debts = useDebtManager();

  const today = options.today ?? todayKey();
  const months = options.months ?? 1;

  /* The year needs future-dated installment chunks. Requested unconditionally
     rather than behind `enabled: months === 12` on purpose: the entry is
     already warm from useCreditCards above, so gating it would save nothing and
     would make the toggle wait on a fetch that had already happened. */
  const ledger = useExcelDB<Transaction>('transactions', { limit: LEDGER_LIMIT });

  /* Normalised here so the identity is stable across renders — an inline array
     literal from the caller would rebuild the projection on every keystroke
     elsewhere on the page. */
  const paydayKey = (options.paydays ?? []).join(',');
  const paydays = useMemo(
    () => (paydayKey ? paydayKey.split(',').map(Number) : []),
    [paydayKey],
  );

  /* Narrowed to the fields the engine needs before it reaches the memo, so a
     re-render that changes an unrelated part of a CardState does not rebuild
     anything. `paymentDueDate` is null on a card with no billing cycle set,
     which is a card that simply has no bill to place. */
  const cardBills = useMemo<CardBill[]>(
    () =>
      cards.cards
        .filter((card) => card.paymentDueDate && card.statementBalance > 0)
        .map((card) => ({
          walletId: card.wallet.id,
          name: card.wallet.name,
          amount: card.statementBalance,
          dueDate: card.paymentDueDate as string,
        })),
    [cards.cards],
  );

  const month = useMemo(
    () =>
      buildLiabilityMonth({
        period,
        subscriptions: subscriptions.items,
        cardBills,
        billSplits: splitter.bills,
        paydays,
        today,
      }),
    [period, subscriptions.items, cardBills, splitter.bills, paydays, today],
  );

  /* Derived once so the year memo has two stable string dependencies rather
     than an object rebuilt on every render. */
  const window = useMemo(() => yearWindow(period), [period]);

  /**
   * Future-dated chunks of installment plans.
   *
   * Filtered, not projected: a plan is written as n dated rows when it is
   * created, so these are facts about the future that already exist in the
   * ledger. Scoped to the window because a chunk already paid is history, and
   * this graph is about what is still coming.
   */
  const installments = useMemo(
    () =>
      months === 12
        ? ledger.items.filter(
            (row) =>
              row.installmentGroupId && row.date >= window.from && row.date <= window.to,
          )
        : [],
    [months, ledger.items, window.from, window.to],
  );

  /* Only built when asked for. A year is cheap but not free, and the month view
     has no use for it — computing both every render would double the work for
     a view nobody is looking at. */
  const year = useMemo(
    () =>
      months === 12
        ? buildLiabilityYear({
            from: window.from,
            to: window.to,
            subscriptions: subscriptions.items,
            cardBills,
            debts: debts.debts,
            installments,
            billSplits: splitter.bills,
            paydays,
            today,
          })
        : null,
    [
      months,
      window.from,
      window.to,
      subscriptions.items,
      cardBills,
      debts.debts,
      installments,
      splitter.bills,
      paydays,
      today,
    ],
  );

  return {
    ...month,
    year,
    initialLoading:
      subscriptions.initialLoading ||
      cards.initialLoading ||
      splitter.initialLoading ||
      debts.initialLoading,
    isValidating:
      subscriptions.isValidating ||
      cards.isValidating ||
      splitter.isValidating ||
      debts.isValidating,
    isEmpty: months === 12 ? (year?.billCount ?? 0) === 0 : month.billCount === 0,
  };
}
