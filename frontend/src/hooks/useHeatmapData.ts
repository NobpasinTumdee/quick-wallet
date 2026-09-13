import { useMemo } from 'react';

import { useBillSplitter } from './useBillSplitter';
import { useCreditCards } from './useCreditCards';
import { useExcelDB } from './useExcelDB';
import { todayKey } from '../lib/format';
import { CardBill, LiabilityMonth, buildLiabilityMonth } from '../lib/liabilityMath';
import { Subscription } from '../types';

/**
 * Everything falling due in one month, from the three places it can come from.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ARITHMETIC IS NOT IN HERE
 * ---------------------------------------------------------------------------
 * This hook does two things: fetch, and hand the rows to `buildLiabilityMonth`.
 * The projection — walking a weekly bill across the month, the month-end
 * clamp, the level thresholds — lives in `lib/liabilityMath` as pure functions
 * so it can be tested against a table of dates instead of against a rendered
 * component. Everything interesting about this feature is in that file; this
 * one is plumbing, and is meant to stay boring.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT COSTS
 * ---------------------------------------------------------------------------
 * `useCreditCards` fetches the unscoped ledger — up to 2000 rows — because a
 * statement balance cannot be derived from one month of transactions. On the
 * Analytics screen that request is already in flight for other widgets, so it
 * is free. On the Subscriptions screen it is genuinely new, and worth knowing
 * about: it is the price of showing card bills next to subscriptions, and the
 * cache is shared, so it is one request and not one per widget.
 */
export interface HeatmapData extends LiabilityMonth {
  initialLoading: boolean;
  isValidating: boolean;
  /** True when nothing at all falls due — the empty state, not an error. */
  isEmpty: boolean;
}

export function useHeatmapData(
  period: string,
  options: { payday?: number | null; today?: string } = {},
): HeatmapData {
  const subscriptions = useExcelDB<Subscription>('subscriptions');
  const cards = useCreditCards();
  const splitter = useBillSplitter();

  const today = options.today ?? todayKey();
  const payday = options.payday ?? null;

  /* Narrowed to the two fields the engine needs before it reaches the memo, so
     a re-render that changes an unrelated part of a CardState does not rebuild
     the month. `paymentDueDate` is null on a card with no billing cycle set,
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
        payday,
        today,
      }),
    [period, subscriptions.items, cardBills, splitter.bills, payday, today],
  );

  return {
    ...month,
    initialLoading:
      subscriptions.initialLoading || cards.initialLoading || splitter.initialLoading,
    isValidating: subscriptions.isValidating || cards.isValidating || splitter.isValidating,
    isEmpty: month.billCount === 0,
  };
}
