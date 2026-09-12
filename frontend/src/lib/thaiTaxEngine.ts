/**
 * Thai personal income tax (ภาษีเงินได้บุคคลธรรมดา, ภ.ง.ด.90/91).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS COMPUTES
 * ---------------------------------------------------------------------------
 * The standard salaried calculation, in four steps:
 *
 *   1. Gross assessable income        Σ income transactions in the range
 *   2. − Expense deduction            50% of gross, capped at ฿100,000
 *      (ค่าใช้จ่าย)
 *   3. − Personal allowance           ฿60,000
 *      (ค่าลดหย่อนส่วนตัว)
 *   = Net taxable income              (เงินได้สุทธิ)
 *   → progressive brackets            (อัตราภาษีแบบขั้นบันได)
 *
 * The 50%/฿100,000 rule is the deduction for employment income under
 * s.40(1) and s.40(2) of the Revenue Code. Other income categories deduct
 * differently — rental income, professional fees and business income each have
 * their own rate — so this engine is correct for salary and bonus and
 * deliberately does not pretend to cover the rest. See `taxAssumptions`.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A PURE FUNCTION IN lib/
 * ---------------------------------------------------------------------------
 * Two reasons. First, a tax figure is the kind of number a user will act on, so
 * the arithmetic has to be readable end to end and checkable without a browser.
 * Second, the calculation is explicitly on-demand: nothing here subscribes,
 * caches, fetches or memoises, so it cannot be triggered by a render, a focus
 * revalidation or a background sync. It runs when someone calls it, once.
 *
 * Every figure the UI shows — including each bracket's own subtotal — comes out
 * of `calculateThaiTax` in one pass. The receipt never does arithmetic of its
 * own, so what is on screen and what is in the PDF cannot disagree.
 */

import { Transaction } from '../types';

/* ------------------------------------------------------------------ */
/* Statutory constants                                                 */
/* ------------------------------------------------------------------ */

/** Employment income (40(1)/(2)) deducts 50%, but never more than this. */
export const EXPENSE_DEDUCTION_RATE = 0.5;
export const EXPENSE_DEDUCTION_CAP = 100_000;

/** ค่าลดหย่อนส่วนตัว — the taxpayer's own allowance. */
export const PERSONAL_ALLOWANCE = 60_000;

/**
 * The progressive ladder. `upTo` is the top of each band; the rate applies only
 * to the slice of income inside it, never to the whole amount — the single most
 * common misunderstanding of a progressive system ("a raise pushed me into a
 * higher bracket so I take home less" is not a thing).
 */
export interface TaxBand {
  /** Top of the band, inclusive. `Infinity` for the last one. */
  upTo: number;
  rate: number;
}

export const TAX_BANDS: readonly TaxBand[] = [
  { upTo: 150_000, rate: 0 },
  { upTo: 300_000, rate: 0.05 },
  { upTo: 500_000, rate: 0.1 },
  { upTo: 750_000, rate: 0.15 },
  { upTo: 1_000_000, rate: 0.2 },
  { upTo: 2_000_000, rate: 0.25 },
  { upTo: 5_000_000, rate: 0.3 },
  { upTo: Infinity, rate: 0.35 },
];

/* ------------------------------------------------------------------ */
/* Allowances the user supplies                                        */
/* ------------------------------------------------------------------ */

/** ประกันสังคม — 5% of wages, but never more than this in a year. */
export const SOCIAL_SECURITY_CAP = 9_000;

/**
 * ประกันชีวิตและสุขภาพ — life and health premiums together.
 *
 * The Revenue Code also caps the *health* portion at ฿25,000 inside this
 * ฿100,000, but this engine takes a single combined figure, so it cannot tell
 * the two apart. Splitting them is the obvious next refinement.
 */
export const INSURANCE_CAP = 100_000;

/**
 * Figures the user enters by hand, because nothing in this app records them.
 *
 * `withholdingTax` is the odd one out and is deliberately not called an
 * allowance: it does not reduce taxable income, it is tax *already paid*. It is
 * subtracted at the very end, which is what turns "tax payable" into "still
 * owed" or "refund due".
 */
export interface AdditionalDeductions {
  /** ประกันสังคม, capped at {@link SOCIAL_SECURITY_CAP}. */
  socialSecurity: number;
  /** ประกันชีวิตและสุขภาพ, capped at {@link INSURANCE_CAP}. */
  insurance: number;
  /**
   * SSF / RMF / Thai ESG combined.
   *
   * Uncapped here on purpose. The real limits interact — each fund type has its
   * own ceiling, they share a ฿500,000 combined limit with provident fund and
   * pension insurance, and several are expressed as a percentage of assessable
   * income. Guessing at that from one number would produce a confidently wrong
   * figure, so the engine takes the user's own total at face value and the UI
   * says so.
   */
  funds: number;
  /** ภาษีหัก ณ ที่จ่าย — tax already withheld at source. */
  withholdingTax: number;
}

export const NO_ADDITIONAL_DEDUCTIONS: AdditionalDeductions = {
  socialSecurity: 0,
  insurance: 0,
  funds: 0,
  withholdingTax: 0,
};

/** One allowance, with the ceiling shown doing its work. */
export interface CappedAllowance {
  /** What the user typed. */
  requested: number;
  /** The statutory ceiling, or null where this engine applies none. */
  cap: number | null;
  /** What was actually deducted. */
  applied: number;
  /** True when the cap cut the requested figure down. */
  capped: boolean;
}

function capped(requested: number, cap: number | null): CappedAllowance {
  // Negatives are user typos, not credits — clamp rather than let one inflate
  // the taxable income.
  const wanted = Math.max(0, Number(requested) || 0);
  const applied = cap === null ? wanted : Math.min(wanted, cap);
  return { requested: wanted, cap, applied, capped: cap !== null && wanted > cap };
}

/* ------------------------------------------------------------------ */
/* Result shape                                                        */
/* ------------------------------------------------------------------ */

export interface BracketBreakdown {
  /** 1-based, as the Revenue Department's own tables number them. */
  step: number;
  /** Exclusive lower bound — the band covers (from, upTo]. */
  from: number;
  upTo: number;
  rate: number;
  /** How much of the net taxable income landed in this band. */
  taxableInBand: number;
  tax: number;
  /** Any income at all reached this band. */
  reached: boolean;
  /** The band the last baht fell into — the user's marginal rate. */
  isMarginal: boolean;
}

/** Every allowance applied, in the order the receipt lists them. */
export interface AllowanceBreakdown {
  /** ค่าลดหย่อนส่วนตัว — statutory, always applied. */
  personal: number;
  socialSecurity: CappedAllowance;
  insurance: CappedAllowance;
  funds: CappedAllowance;
  /** personal + the three applied figures. */
  total: number;
}

export interface ThaiTaxResult {
  from: string;
  to: string;
  /** Income rows counted. Shown so an unexpected total can be traced. */
  transactionCount: number;

  grossIncome: number;
  /** Before the cap — kept so the receipt can show the cap doing its work. */
  expenseDeductionUncapped: number;
  expenseDeduction: number;
  /** True when the 50% figure was cut down to the ฿100,000 ceiling. */
  expenseDeductionCapped: boolean;
  allowances: AllowanceBreakdown;
  /** expenseDeduction + allowances.total. */
  totalDeductions: number;

  netTaxableIncome: number;
  brackets: BracketBreakdown[];
  /** The tax the bands produce, before anything already paid is credited. */
  taxPayable: number;

  /* ---- Settlement ----
     Withholding is not a deduction and does not touch any figure above: it is
     tax already handed to the Revenue Department on your behalf. Crediting it
     here is what turns "this is your tax" into "this is what is left to pay",
     which is the number a payslip-employee actually wants. */
  /** ภาษีหัก ณ ที่จ่าย, as entered. */
  withholdingTax: number;
  /** taxPayable − withholdingTax. Negative means overpaid. */
  netTaxDue: number;
  isRefund: boolean;
  /** Always positive. Zero when nothing is owed. */
  amountOwed: number;
  /** Always positive. Zero when nothing is refundable. */
  refundAmount: number;

  /** Tax as a share of gross income. Uses `taxPayable`, not `netTaxDue`:
   *  withholding changes when you paid, never how much you owed. */
  effectiveRate: number;
  /** The rate on the next baht earned. */
  marginalRate: number;
  /** Spread over the year, for comparing against a payslip deduction. */
  monthlyEquivalent: number;
  /** What is left of gross income after the tax due on it. */
  netAfterTax: number;

  /** The caveats that actually apply to *this* result. See `taxAssumptions`. */
  assumptions: string[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Money is rounded to satang. Floats otherwise leak 0.30000000000000004. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The income rows in scope.
 *
 * Transfers are excluded explicitly rather than by relying on the type filter:
 * moving ฿50,000 from a savings wallet to a current account is not income, and
 * counting it would inflate the tax on money that was already taxed once.
 */
export function selectAssessableIncome(
  transactions: Transaction[],
  from: string,
  to: string,
): Transaction[] {
  return transactions.filter(
    (tx) =>
      tx.type === 'income' &&
      Boolean(tx.date) &&
      // Date keys are `YYYY-MM-DD`, so a lexical compare is chronological.
      (!from || tx.date >= from) &&
      (!to || tx.date <= to),
  );
}

/* ------------------------------------------------------------------ */
/* Assumptions                                                         */
/* ------------------------------------------------------------------ */

/**
 * The caveats that apply to a *particular* result.
 *
 * Built from the result rather than kept as a fixed list, because the list is
 * no longer fixed: once someone enters their social security contribution, "no
 * social security is included" is a lie, and a disclaimer that says things the
 * user has already corrected trains them to stop reading it.
 *
 * Both the receipt and the PDF render exactly this array, so they can never
 * disagree about what was and was not accounted for.
 */
export function taxAssumptions(result: {
  allowances: AllowanceBreakdown;
  withholdingTax: number;
}): string[] {
  const notes: string[] = [
    'Treats all income as employment income under s.40(1)/(2) — salary, wages and bonus. Rental, freelance, dividend and interest income deduct at different rates.',
  ];

  /* Name only what is genuinely still missing. */
  const missing: string[] = ['spouse', 'children', 'parental care', 'donations', 'mortgage interest', 'provident fund'];
  if (result.allowances.socialSecurity.applied === 0) missing.push('social security');
  if (result.allowances.insurance.applied === 0) missing.push('life and health insurance');
  if (result.allowances.funds.applied === 0) missing.push('SSF, RMF and Thai ESG');

  const listed =
    missing.length > 1
      ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
      : missing[0];

  notes.push(
    `Allowances for ${listed} are not included, and every one of them would reduce the tax due.`,
  );

  if (result.allowances.funds.applied > 0) {
    notes.push(
      'The investment-fund figure is taken exactly as entered. Its real ceilings interact — each fund type has its own limit, and together with provident fund and pension insurance they share a ฿500,000 cap — so confirm your own total against those limits.',
    );
  }

  if (result.withholdingTax === 0) {
    notes.push(
      'No withholding tax was entered. For a salaried employee the amount already deducted at source usually covers most or all of the tax below.',
    );
  } else {
    notes.push(
      'The withholding figure is taken as entered and is credited against the tax due. Check it against your 50 Tawi certificate before relying on the settlement figure.',
    );
  }

  notes.push(
    'Counts what is recorded in this app for the chosen dates. A Thai tax year is the calendar year, and unrecorded income is not counted.',
    'An estimate for planning, not a filing. Confirm with the Revenue Department or an accountant before you file.',
  );

  return notes;
}

/* ------------------------------------------------------------------ */
/* The calculation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Runs the whole thing. Synchronous, allocation-light, and safe to call with an
 * empty list — a year with no recorded income is a legitimate ฿0 answer, not an
 * error state.
 *
 * `deductions` is optional and defaults to nothing, so the four-step statutory
 * calculation is exactly what you get when the user has not opened the extra
 * inputs.
 */
export function calculateThaiTax(
  transactions: Transaction[],
  from: string,
  to: string,
  deductions: Partial<AdditionalDeductions> = {},
): ThaiTaxResult {
  const income = selectAssessableIncome(transactions, from, to);

  const grossIncome = round2(income.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0));

  /* ---- Step 2: the 50% expense deduction, capped ---- */
  const expenseDeductionUncapped = round2(grossIncome * EXPENSE_DEDUCTION_RATE);
  const expenseDeduction = Math.min(expenseDeductionUncapped, EXPENSE_DEDUCTION_CAP);

  /* ---- Step 3: allowances ----
     Not clamped against income: the deductions are summed and the *net* is
     floored at zero below, which is the same result and one fewer special
     case to reason about. */
  const socialSecurity = capped(deductions.socialSecurity ?? 0, SOCIAL_SECURITY_CAP);
  const insurance = capped(deductions.insurance ?? 0, INSURANCE_CAP);
  const funds = capped(deductions.funds ?? 0, null);

  const allowances: AllowanceBreakdown = {
    personal: PERSONAL_ALLOWANCE,
    socialSecurity,
    insurance,
    funds,
    total: round2(
      PERSONAL_ALLOWANCE + socialSecurity.applied + insurance.applied + funds.applied,
    ),
  };

  const totalDeductions = round2(expenseDeduction + allowances.total);

  /* ---- Step 4: net taxable income ----
     Floored at zero. Deductions exceeding income do not create a refund — that
     is what the withholding credit below is for, and conflating the two would
     invent money. */
  const netTaxableIncome = round2(Math.max(0, grossIncome - totalDeductions));

  /* ---- The ladder ----
     Each band taxes only its own slice. `taken` tracks how much of the net has
     already been assigned to lower bands. */
  const brackets: BracketBreakdown[] = [];
  let taken = 0;
  let marginalRate = 0;

  for (let index = 0; index < TAX_BANDS.length; index += 1) {
    const band = TAX_BANDS[index];
    const bandFrom = index === 0 ? 0 : TAX_BANDS[index - 1].upTo;
    const bandWidth = band.upTo - bandFrom;

    const taxableInBand = round2(Math.max(0, Math.min(netTaxableIncome - taken, bandWidth)));
    taken += taxableInBand;

    const reached = taxableInBand > 0;
    if (reached) marginalRate = band.rate;

    brackets.push({
      step: index + 1,
      from: bandFrom,
      upTo: band.upTo,
      rate: band.rate,
      taxableInBand,
      tax: round2(taxableInBand * band.rate),
      reached,
      isMarginal: false,
    });
  }

  // The last band with anything in it is where the next baht would be taxed.
  const lastReached = [...brackets].reverse().find((bracket) => bracket.reached);
  if (lastReached) lastReached.isMarginal = true;

  /* Summed from the *rounded* per-band figures rather than recomputed from the
     net, so the receipt's rows always add up to its total. A table that does
     not foot is the fastest way to lose a reader's trust in the number. */
  const taxPayable = round2(brackets.reduce((sum, bracket) => sum + bracket.tax, 0));

  /* ---- Settlement ----
     A negative net is an overpayment, not a negative tax. Splitting it into two
     always-positive figures means the UI never has to render "you owe -฿4,200",
     which reads as a bug even when the arithmetic is right. */
  const withholdingTax = Math.max(0, Number(deductions.withholdingTax) || 0);
  const netTaxDue = round2(taxPayable - withholdingTax);

  const result: ThaiTaxResult = {
    from,
    to,
    transactionCount: income.length,

    grossIncome,
    expenseDeductionUncapped,
    expenseDeduction,
    expenseDeductionCapped: expenseDeductionUncapped > EXPENSE_DEDUCTION_CAP,
    allowances,
    totalDeductions,

    netTaxableIncome,
    brackets,
    taxPayable,

    withholdingTax,
    netTaxDue,
    isRefund: netTaxDue < 0,
    amountOwed: Math.max(0, netTaxDue),
    refundAmount: Math.max(0, -netTaxDue),

    effectiveRate: grossIncome > 0 ? (taxPayable / grossIncome) * 100 : 0,
    marginalRate: marginalRate * 100,
    monthlyEquivalent: round2(taxPayable / 12),
    netAfterTax: round2(grossIncome - taxPayable),

    assumptions: [],
  };

  result.assumptions = taxAssumptions(result);
  return result;
}

/* ------------------------------------------------------------------ */
/* Range helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * The default range: 1 January of the current year through today.
 *
 * A Thai tax year is the calendar year with no election to change it, so
 * year-to-date is the only range that answers "what do I owe so far?".
 */
export function defaultTaxRange(now = new Date()): { from: string; to: string } {
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    from: `${now.getFullYear()}-01-01`,
    to: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };
}

/** A whole calendar year — what you want when filing for the year just ended. */
export function taxYearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
