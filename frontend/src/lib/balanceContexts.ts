import { lockedInGoals } from './goalMath';
import { Goal } from '../types';

/**
 * The three readings of "how much do I have".
 *
 * ---------------------------------------------------------------------------
 * WHY THREE FIGURES AND NOT ONE
 * ---------------------------------------------------------------------------
 * "What am I worth" and "what can I spend" are different questions, and a
 * single headline number answers whichever one the reader happens to have in
 * mind — which is how someone with ฿400,000 of it in a brokerage account and
 * ฿180,000 earmarked for a wedding concludes they can afford a holiday.
 *
 *   total      everything: cash, cards, and holdings at market or at cost
 *   liquid     the same, minus investments — money that does not need selling
 *   available  liquid, minus what the goal envelopes have already claimed
 *
 * Each is the one below it plus a layer, so swiping right is always "and what
 * if I take that out too". The order is fixed for that reason: the carousel is
 * a subtraction, not a menu.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MATH IS HERE AND NOT IN THE COMPONENT
 * ---------------------------------------------------------------------------
 * `available` is a number people make decisions with, and it is assembled from
 * three sources that each have their own rules — the server's wallet
 * aggregates, the live-quote portfolio, and the goals table. Pure functions in
 * a file with tests beside them is the only way that stays checkable.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS RELATES TO THE GOALS SCREEN'S "AVAILABLE TO SPEND"
 * ---------------------------------------------------------------------------
 * They subtract the same earmarks — `lockedInGoals` is shared — from
 * deliberately different starting points, and the labels say so.
 *
 * The goals screen starts from `spendableCash`: cash wallets only, cards
 * excluded, because that page is about whether the envelopes are backed by
 * money that exists. The dashboard starts from `liquidBalance`, which nets
 * card debt, because that card is about what is actually yours to spend and
 * money already owed on a card is not. A user holding no credit wallets sees
 * the same figure on both.
 */

export type BalanceContextId = 'total' | 'liquid' | 'available';

export interface BalanceContext {
  id: BalanceContextId;
  value: number;
  /** What the previous context had taken off it. 0 for `total`. */
  deducted: number;
}

export interface BalanceInput {
  /** Cash, cards and holdings — the headline. */
  netWorth: number;
  /** Spending wallets only, cards netted. Investments excluded. */
  liquidBalance: number;
  /** Goals as they stand. Purchased ones no longer reserve anything. */
  goals: Goal[];
}

/**
 * The carousel's three slides, in order.
 *
 * `available` is allowed to go negative: earmarking more than is left is a
 * real state — you promised ฿50,000 to a goal and then spent some of it — and
 * flooring it at zero would remove the only signal that the plan and the
 * balance have drifted apart. The same argument `allocationSummary` makes.
 */
export function balanceContexts({ netWorth, liquidBalance, goals }: BalanceInput): BalanceContext[] {
  const total = round2(netWorth);
  const liquid = round2(liquidBalance);
  const locked = lockedInGoals(goals);

  return [
    { id: 'total', value: total, deducted: 0 },
    /* What investments account for, stated as the difference rather than
       recomputed from the portfolio: the two figures arrive from different
       places (a live-quote total and a server aggregate) and subtracting one
       from the other is the only way the slide's caption can be guaranteed to
       reconcile with the number above it. */
    { id: 'liquid', value: liquid, deducted: round2(total - liquid) },
    { id: 'available', value: round2(liquid - locked), deducted: locked },
  ];
}

/**
 * The same three, for a month that has already ended.
 *
 * Only two of them exist. The snapshot knows what the wallets held on the last
 * day of March, but a goal has no history: `savedAmount` is a single cell that
 * says what is earmarked *now*. Subtracting today's envelopes from March's
 * balance would produce a figure true of no moment in time — exactly the
 * mistake the time-travel caption on the dashboard exists to prevent — so the
 * third slide is not offered at all rather than offered with a caveat nobody
 * reads.
 */
export function historicalContexts(netWorth: number, liquidBalance: number): BalanceContext[] {
  const total = round2(netWorth);
  const liquid = round2(liquidBalance);
  return [
    { id: 'total', value: total, deducted: 0 },
    { id: 'liquid', value: liquid, deducted: round2(total - liquid) },
  ];
}

function round2(value: number): number {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}
