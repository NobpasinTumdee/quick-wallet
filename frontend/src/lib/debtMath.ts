import { Debt } from '../types';

/**
 * Loan arithmetic.
 *
 * ---------------------------------------------------------------------------
 * EVERYTHING HERE IS AN ESTIMATE, AND SAYS SO
 * ---------------------------------------------------------------------------
 * A real lender compounds daily, charges fees, applies payments on a value date
 * that is not the day you sent them, and rounds in its own favour. None of that
 * is knowable from four numbers in a sheet.
 *
 * So these functions answer "roughly how bad is this" and never "what do I
 * owe" — the balance is whatever the lender's statement says, and
 * `debts.update` is how that gets in. Every figure below is derived from the
 * stored balance and APR alone, using simple monthly interest, and the names
 * say `projected` or `estimate` wherever that matters.
 *
 * The one thing they are used for that is not decorative is the
 * `neverAmortises` warning, which is robust to all of the above: if a payment
 * does not cover one month's interest, no amount of compounding detail changes
 * the conclusion.
 */

/** Two decimal places, matching `money_` on the server. */
const money = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

/**
 * One month of simple interest on a balance, at an annual percentage rate.
 *
 * APR ÷ 12, not the compounding-equivalent monthly rate. The two differ by
 * about 0.2% of the figure at 6% APR, and the simple form is the one every
 * lender's "interest this month" line actually uses — matching the statement
 * the user is holding matters more here than being theoretically tidier.
 */
export function projectedMonthlyInterest(currentBalance: number, interestRateApr: number): number {
  const balance = Math.max(0, Number(currentBalance) || 0);
  const apr = Math.max(0, Number(interestRateApr) || 0);
  return money((balance * (apr / 100)) / 12);
}

/** What one payment does, split into the part that clears interest and the rest. */
export interface PaymentSplit {
  /** The month's interest, which the payment covers first. */
  interest: number;
  /** What is left over to reduce the balance. Never negative. */
  principal: number;
  /** True when the payment does not even cover the interest. */
  shortfall: boolean;
}

/**
 * How a payment divides.
 *
 * Note this is *not* how `debts.pay` moves the balance — that subtracts the
 * whole payment, because this app never capitalises interest, so there is no
 * accrued interest sitting in the balance for a payment to clear first. This
 * function answers a different question: of the money you are about to hand
 * over, how much is rent on the loan rather than progress against it.
 */
export function paymentSplit(debt: Debt, amount: number): PaymentSplit {
  const payment = Math.max(0, Number(amount) || 0);
  const interest = projectedMonthlyInterest(debt.currentBalance, debt.interestRateApr);
  return {
    interest: money(Math.min(interest, payment)),
    principal: money(Math.max(0, payment - interest)),
    shortfall: payment > 0 && payment < interest,
  };
}

export interface PayoffEstimate {
  /** Months to clear the balance, or null when it never clears. */
  months: number | null;
  /** Total interest paid over those months. Null alongside a null `months`. */
  totalInterest: number | null;
  /**
   * The payment does not cover one month's interest, so the balance grows
   * forever. The single most useful thing this file can tell somebody.
   */
  neverAmortises: boolean;
  /** No minimum payment recorded, so there is nothing to project from. */
  unknown: boolean;
}

/** Refuses to iterate longer than this. 100 years is not an answer anyone wants. */
const MAX_PAYOFF_MONTHS = 1200;

/**
 * How long this takes to clear at a given monthly payment.
 *
 * Amortised month by month rather than with the closed-form logarithm. The loop
 * is a few dozen iterations at worst, it handles a zero rate without a special
 * case, and — the reason that decides it — it produces the total interest in
 * the same pass, which the formula would need a second derivation for.
 */
export function payoffEstimate(debt: Debt, monthlyPayment?: number): PayoffEstimate {
  const payment = Math.max(0, Number(monthlyPayment ?? debt.minimumPayment) || 0);
  let balance = Math.max(0, Number(debt.currentBalance) || 0);
  const apr = Math.max(0, Number(debt.interestRateApr) || 0);

  if (balance <= 0) {
    return { months: 0, totalInterest: 0, neverAmortises: false, unknown: false };
  }
  if (payment <= 0) {
    return { months: null, totalInterest: null, neverAmortises: false, unknown: true };
  }

  const monthlyRate = apr / 100 / 12;

  /* Checked before the loop rather than discovered by hitting the iteration
     cap: at exactly break-even the balance never moves, and the cap would
     report "over 100 years" for something that is simply never. */
  if (payment <= balance * monthlyRate) {
    return { months: null, totalInterest: null, neverAmortises: true, unknown: false };
  }

  let months = 0;
  let interestPaid = 0;

  while (balance > 0 && months < MAX_PAYOFF_MONTHS) {
    const interest = balance * monthlyRate;
    interestPaid += interest;
    balance = balance + interest - payment;
    months += 1;
    // Floating point can leave a fraction of a satang behind forever.
    if (balance < 0.005) balance = 0;
  }

  if (balance > 0) {
    return { months: null, totalInterest: null, neverAmortises: false, unknown: false };
  }

  return {
    months,
    totalInterest: money(interestPaid),
    neverAmortises: false,
    unknown: false,
  };
}

export interface DebtSummary {
  /** Everything still owed, across every debt. */
  totalOutstanding: number;
  /** Everything originally borrowed. */
  totalPrincipal: number;
  /** Principal cleared so far. */
  totalPaid: number;
  /** 0–100, across the portfolio rather than averaged per debt. */
  percentPaid: number;
  /** One month of interest across every debt, at today's balances. */
  monthlyInterest: number;
  /** Every minimum payment added up — the monthly floor. */
  monthlyCommitment: number;
  activeCount: number;
  settledCount: number;
  /** The costliest debt by monthly interest, or null when there is none. */
  mostExpensive: Debt | null;
  /** Any debt whose minimum payment cannot cover its own interest. */
  neverAmortising: Debt[];
}

export function debtSummary(debts: Debt[]): DebtSummary {
  let totalOutstanding = 0;
  let totalPrincipal = 0;
  let monthlyInterest = 0;
  let monthlyCommitment = 0;
  let activeCount = 0;
  let settledCount = 0;
  let mostExpensive: Debt | null = null;
  let mostExpensiveInterest = 0;
  const neverAmortising: Debt[] = [];

  for (const debt of debts) {
    const balance = Math.max(0, Number(debt.currentBalance) || 0);
    const interest = projectedMonthlyInterest(balance, debt.interestRateApr);

    totalOutstanding += balance;
    totalPrincipal += Math.max(0, Number(debt.principalAmount) || 0);
    monthlyInterest += interest;

    if (balance <= 0) {
      settledCount += 1;
      continue;
    }

    activeCount += 1;
    monthlyCommitment += Math.max(0, Number(debt.minimumPayment) || 0);

    if (interest > mostExpensiveInterest) {
      mostExpensiveInterest = interest;
      mostExpensive = debt;
    }

    if (payoffEstimate(debt).neverAmortises) neverAmortising.push(debt);
  }

  const totalPaid = Math.max(0, totalPrincipal - totalOutstanding);

  return {
    totalOutstanding: money(totalOutstanding),
    totalPrincipal: money(totalPrincipal),
    totalPaid: money(totalPaid),
    percentPaid: totalPrincipal > 0 ? money(Math.min(100, (totalPaid / totalPrincipal) * 100)) : 0,
    monthlyInterest: money(monthlyInterest),
    monthlyCommitment: money(monthlyCommitment),
    activeCount,
    settledCount,
    mostExpensive,
    neverAmortising,
  };
}

/**
 * Is a payment of `amount` from a wallet holding `balance` going to overdraw it?
 *
 * Warned about rather than blocked. A cash wallet can legitimately go negative
 * in this app — it is a record of what happened, not a gate on what may — and
 * somebody paying a debt from an account the app thinks is empty usually knows
 * something the app does not.
 */
export function overdrawsWallet(walletBalance: number, amount: number): boolean {
  return (Number(amount) || 0) > (Number(walletBalance) || 0);
}
