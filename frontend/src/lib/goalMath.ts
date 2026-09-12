import { Goal, WalletBalance } from '../types';

/**
 * The arithmetic behind sinking funds.
 *
 * ---------------------------------------------------------------------------
 * THE ONE IDEA
 * ---------------------------------------------------------------------------
 * A goal never moves money. It records that some of the cash already in your
 * wallets is spoken for. So there are three figures, and the distinction
 * between them is the entire feature:
 *
 *   Total cash          what you hold
 *   Locked in goals     what you have promised to something
 *   Available to spend  the difference — the only one that answers
 *                       "can I afford this?"
 *
 * Nothing here reads or writes a balance. If any of it ever needs to, the
 * feature has been misunderstood.
 */

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Cash                                                                */
/* ------------------------------------------------------------------ */

/**
 * Money you actually hold.
 *
 * Spending wallets only — an investment wallet's cash is earmarked by being
 * where it is — and **credit cards are excluded**. A card's balance is debt,
 * not cash: counting a −฿20,000 card against your goals would say you have
 * less money to promise than you do, and counting it as +฿20,000 of headroom
 * would be worse. Archived wallets are gone as far as spending is concerned.
 */
export function spendableCash(wallets: WalletBalance[]): number {
  return round2(
    wallets
      .filter((wallet) => wallet.mode === 'expense' && wallet.kind !== 'credit' && !wallet.archived)
      .reduce((sum, wallet) => sum + (Number(wallet.balance) || 0), 0),
  );
}

export interface Allocation {
  totalCash: number;
  /** Σ savedAmount across every goal. */
  locked: number;
  /** `totalCash − locked`. Negative when the envelopes outrun the cash. */
  available: number;
  /** True when more has been earmarked than is held. */
  overCommitted: boolean;
  /** Locked as a share of cash, capped at 100 for the bar. */
  lockedPercent: number;
}

/**
 * The header figures.
 *
 * `available` is deliberately allowed to go negative rather than being floored
 * at zero. Over-committing is a real state — you earmarked ฿50,000 and then
 * spent some of it — and hiding it behind a cheerful ฿0 would remove the only
 * signal that the plan and the balance have drifted apart.
 */
export function allocationSummary(wallets: WalletBalance[], goals: Goal[]): Allocation {
  const totalCash = spendableCash(wallets);
  const locked = round2(goals.reduce((sum, goal) => sum + (Number(goal.savedAmount) || 0), 0));
  const available = round2(totalCash - locked);

  return {
    totalCash,
    locked,
    available,
    overCommitted: available < 0,
    lockedPercent: totalCash > 0 ? Math.min(100, round2((locked / totalCash) * 100)) : locked > 0 ? 100 : 0,
  };
}

/* ------------------------------------------------------------------ */
/* A single goal                                                       */
/* ------------------------------------------------------------------ */

export interface GoalPace {
  /** Whole months from today to the deadline, floored at 0. */
  monthsLeft: number;
  /** What to set aside each month to arrive on time. 0 when already funded. */
  perMonth: number;
  /** The deadline is in the past and the goal is not funded. */
  overdue: boolean;
  /** No deadline set — there is no pace to compute. */
  open: boolean;
}

/**
 * What it takes to arrive on time.
 *
 * Months are counted by calendar month rather than by dividing days by 30, so
 * "by 1 March" from 20 February is one month, not nought-point-three. The
 * remaining amount is spread over the months *left*, which means the figure
 * naturally climbs as the deadline approaches — that is the honest behaviour,
 * not a bug to smooth over.
 */
export function goalPace(goal: Goal, today = new Date()): GoalPace {
  const remaining = Math.max(0, (Number(goal.targetAmount) || 0) - (Number(goal.savedAmount) || 0));

  if (!goal.deadline) {
    return { monthsLeft: 0, perMonth: 0, overdue: false, open: true };
  }

  const [year, month, day] = goal.deadline.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return { monthsLeft: 0, perMonth: 0, overdue: false, open: true };
  }

  const due = new Date(year, month - 1, day || 1);
  const monthsLeft = Math.max(
    0,
    (due.getFullYear() - today.getFullYear()) * 12 +
      (due.getMonth() - today.getMonth()) +
      // A deadline later in the current month still leaves this month to save in.
      (due.getDate() >= today.getDate() ? 0 : -1),
  );

  const funded = remaining <= 0;

  return {
    monthsLeft,
    // With no whole months left, the whole remainder is due now — not divided
    // by zero, and not quietly reported as nothing.
    perMonth: funded ? 0 : monthsLeft > 0 ? round2(remaining / monthsLeft) : round2(remaining),
    overdue: !funded && due < new Date(today.getFullYear(), today.getMonth(), today.getDate()),
    open: false,
  };
}

/** Progress for the ring: clamped to 0…100, unlike the raw `percentComplete`. */
export function ringPercent(goal: Goal): number {
  const target = Number(goal.targetAmount) || 0;
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, ((Number(goal.savedAmount) || 0) / target) * 100));
}
