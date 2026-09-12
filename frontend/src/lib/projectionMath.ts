/**
 * Net worth projection.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT MODELS
 * ---------------------------------------------------------------------------
 * Today's net worth, plus a fixed monthly contribution, compounding at a chosen
 * annual rate. Month by month:
 *
 *     balance = balance × (1 + monthlyRate) + contribution
 *
 * ---------------------------------------------------------------------------
 * WHY THE MONTHLY RATE IS A TWELFTH ROOT AND NOT A TWELFTH
 * ---------------------------------------------------------------------------
 * The input is an *annual* rate, so the monthly rate has to be the one that
 * compounds back to it: `(1 + r)^(1/12) - 1`.
 *
 * The tempting `r / 12` is a nominal rate compounded monthly, which yields more
 * than r over a year — 5% becomes 5.116%. Small, until it runs for ten years
 * against a growing balance, and it errs in the flattering direction, which is
 * the wrong way for a projection to be wrong.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT MODEL
 * ---------------------------------------------------------------------------
 * Inflation, tax on gains, contribution growth with income, and the fact that
 * real returns arrive as a jagged sequence rather than a smooth curve — the
 * order of good and bad years changes the outcome even when the average does
 * not. Figures are nominal. The UI says so; a ten-year number presented without
 * that caveat quietly overstates what it will buy.
 */

/** A conservative long-run default. The UI lets the user move it. */
export const DEFAULT_ANNUAL_RETURN_PERCENT = 5;

/** Months of history averaged for the contribution estimate. */
export const SAVINGS_LOOKBACK_MONTHS = 6;

export interface ProjectionInputs {
  /** Net worth today — the opening balance. May be negative. */
  startingNetWorth: number;
  /** Added at the end of every month. */
  monthlyContribution: number;
  /** Annual return as a percentage: 5 means 5% a year. */
  annualReturnPercent: number;
  /** How far out to project. */
  years: number;
}

export interface ProjectionPoint {
  /** Months from now; 0 is today. */
  month: number;
  /** Calendar year this point lands in, for the axis. */
  year: number;
  /** Total projected balance. */
  value: number;
  /** Opening balance plus every contribution so far — money you put in. */
  contributed: number;
  /** `value - contributed`: what compounding added. Never negative in practice
   *  at a positive rate, but signed so a negative rate reads honestly. */
  growth: number;
}

export interface Projection {
  points: ProjectionPoint[];
  /** The last point, hoisted because every headline reads from it. */
  final: ProjectionPoint;
  /** Effective monthly rate actually used. */
  monthlyRate: number;
  /** Total contributed over the whole horizon, excluding the opening balance. */
  totalContributions: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Runs the projection, one point per month.
 *
 * Monthly rather than yearly because the contribution lands monthly — stepping
 * a year at a time would either ignore that or need a separate annuity term,
 * and 121 points is nothing to plot.
 */
export function projectNetWorth({
  startingNetWorth,
  monthlyContribution,
  annualReturnPercent,
  years,
}: ProjectionInputs): Projection {
  const horizonYears = Math.max(1, Math.min(50, Math.round(years) || 1));
  const months = horizonYears * 12;

  const annualRate = (Number(annualReturnPercent) || 0) / 100;
  // Guard the root against a rate at or below -100%, which has no real solution.
  const monthlyRate = annualRate <= -1 ? -1 : Math.pow(1 + annualRate, 1 / 12) - 1;

  const opening = Number(startingNetWorth) || 0;
  const contribution = Number(monthlyContribution) || 0;

  const thisYear = new Date().getFullYear();
  const thisMonth = new Date().getMonth();

  let balance = opening;
  let contributed = opening;

  const points: ProjectionPoint[] = [
    {
      month: 0,
      year: thisYear,
      value: round2(balance),
      contributed: round2(contributed),
      growth: 0,
    },
  ];

  for (let month = 1; month <= months; month += 1) {
    // Growth on the balance you held through the month, then the deposit —
    // an ordinary annuity. Crediting the deposit first would pay a month's
    // return on money that was not there yet.
    balance = balance * (1 + monthlyRate) + contribution;
    contributed += contribution;

    points.push({
      month,
      year: thisYear + Math.floor((thisMonth + month) / 12),
      value: round2(balance),
      contributed: round2(contributed),
      growth: round2(balance - contributed),
    });
  }

  return {
    points,
    final: points[points.length - 1],
    monthlyRate,
    totalContributions: round2(contribution * months),
  };
}

/* ------------------------------------------------------------------ */
/* Deriving the contribution from history                              */
/* ------------------------------------------------------------------ */

/** The shape `/api/dashboard` already returns in `trend`. */
export interface TrendMonth {
  period: string;
  income: number;
  expense: number;
  net: number;
}

export interface SavingsEstimate {
  /** Average monthly net, over the months actually used. */
  monthly: number;
  /** How many months went into it. */
  monthsUsed: number;
  /** True when there was not enough history to be worth trusting. */
  sparse: boolean;
}

/**
 * Average monthly savings from the dashboard's own trend.
 *
 * Two things it is careful about:
 *
 *   - **The current month is dropped.** It is partial by definition — on the
 *     3rd, one month of income has not arrived but three days of coffee have —
 *     so including it drags the average down by an amount that depends on
 *     nothing but today's date.
 *   - **Empty months are dropped.** A month with no income and no expense is a
 *     month before the user started recording, not a month they saved zero.
 *     Averaging those in halves the estimate for anyone who has been using the
 *     app for less than the lookback window.
 */
export function estimateMonthlySavings(
  trend: TrendMonth[],
  lookbackMonths = SAVINGS_LOOKBACK_MONTHS,
  currentPeriod = new Date().toISOString().slice(0, 7),
): SavingsEstimate {
  const complete = trend.filter(
    (month) =>
      month.period !== currentPeriod &&
      ((Number(month.income) || 0) !== 0 || (Number(month.expense) || 0) !== 0),
  );

  const window = complete.slice(-Math.max(1, lookbackMonths));
  if (!window.length) return { monthly: 0, monthsUsed: 0, sparse: true };

  const total = window.reduce((sum, month) => sum + (Number(month.net) || 0), 0);

  return {
    monthly: round2(total / window.length),
    monthsUsed: window.length,
    // Under three months is one payday and a holiday — a shape, not a rate.
    sparse: window.length < 3,
  };
}
