/**
 * The arithmetic behind splitting a bill.
 *
 * ---------------------------------------------------------------------------
 * THE ONE IDEA THAT MATTERS
 * ---------------------------------------------------------------------------
 * The payer is on the bill too. "Split ฿1,200 between me and two friends" is
 * three ways, not two, and the two friends owe ฿400 each — not ฿600.
 *
 * So the shares stored against a bill are *other people's* shares, and they
 * deliberately sum to less than the total. What is left over is the payer's own
 * share, which is never stored: it is `totalAmount - sum(shares)`, and deriving
 * it rather than recording it is what stops the two disagreeing after an edit.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PAYER ABSORBS THE ROUNDING
 * ---------------------------------------------------------------------------
 * ฿100 three ways is ฿33.333…, and money has two decimal places. Somebody has
 * to take the extra satang. Giving it to a friend means asking them for a
 * number they cannot verify from the receipt; giving it to the payer means the
 * person who chose to split the bill quietly covers a rounding error worth less
 * than a coin. The second is obviously right, and it also keeps every friend's
 * share identical, which is what "split equally" is supposed to mean.
 */

/** Two decimal places is as fine as money gets here. */
function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Money comparisons need a tolerance. Mirrors `SPLIT_EPSILON` in Code.gs. */
export const SPLIT_EPSILON = 0.005;

export type SplitMode = 'equal' | 'custom';

/** A row in the form. `amount` stays a raw string while the user types. */
export interface SplitDraft {
  /** Stable across renames and reorders, so React keys never collide. */
  id: string;
  personName: string;
  amount: string;
}

export interface SplitTotals {
  /** What the other people owe, added up. */
  owedTotal: number;
  /** `total - owedTotal`. Negative when the shares overshoot. */
  ownShare: number;
  /** Shares that are over the bill — the one state that blocks submission. */
  exceedsTotal: boolean;
  /** By how much, when they do. Zero otherwise. */
  excess: number;
  /** Every share has a name and a positive amount. */
  complete: boolean;
  /** People with a name but no usable amount yet. */
  incompleteCount: number;
}

/**
 * What the form needs to know about the current draft, in one pass.
 *
 * `exceedsTotal` is the only hard failure. Shares that fall *short* of the
 * total are normal — that is the payer's own share — so undershooting must not
 * be treated as an error, which is the mistake a naive `sum !== total` check
 * makes.
 */
export function summariseSplits(splits: SplitDraft[], total: number): SplitTotals {
  let owedTotal = 0;
  let incompleteCount = 0;

  for (const split of splits) {
    const named = split.personName.trim().length > 0;
    const amount = Number(split.amount);
    const usable = Number.isFinite(amount) && amount > 0;

    if (usable) owedTotal += amount;
    if (named && !usable) incompleteCount += 1;
  }

  owedTotal = round2(owedTotal);
  const safeTotal = round2(Number(total) || 0);
  const excess = round2(owedTotal - safeTotal);

  return {
    owedTotal,
    ownShare: round2(safeTotal - owedTotal),
    exceedsTotal: excess > SPLIT_EPSILON,
    excess: excess > SPLIT_EPSILON ? excess : 0,
    complete:
      splits.length > 0 &&
      incompleteCount === 0 &&
      splits.every((s) => s.personName.trim().length > 0),
    incompleteCount,
  };
}

/**
 * Divides `total` between the payer and everyone named, and returns only the
 * others' shares.
 *
 * `includeSelf` is what makes this correct rather than merely plausible. With
 * it on — the default, and what "split equally" means to most people — the
 * divisor is `people + 1`. With it off, the payer is buying for others and
 * keeping nothing, so the whole bill is divided between them.
 *
 * Returns amounts as strings because that is what the form holds while typing;
 * converting here rather than at every call site keeps one representation.
 */
export function splitEqually(
  splits: SplitDraft[],
  total: number,
  includeSelf = true,
): SplitDraft[] {
  const people = splits.length;
  if (people === 0) return splits;

  const safeTotal = Math.max(0, Number(total) || 0);
  const divisor = includeSelf ? people + 1 : people;

  /* Floor to the satang rather than rounding, so the shares can never add up to
     more than the bill. Rounding 33.335 up three times would hand out 100.01
     and trip the server's own guard. The shortfall lands on the payer. */
  const each = Math.floor((safeTotal * 100) / divisor) / 100;

  return splits.map((split) => ({ ...split, amount: each > 0 ? String(each) : '' }));
}

/**
 * The equal share each person would get, for previewing the split before any
 * names are typed. Same flooring rule as `splitEqually`.
 */
export function equalShare(total: number, people: number, includeSelf = true): number {
  const divisor = includeSelf ? people + 1 : people;
  if (divisor <= 0) return 0;
  return Math.floor((Math.max(0, Number(total) || 0) * 100) / divisor) / 100;
}

/** Strips the drafting fields and drops rows the user never filled in. */
export function toPayload(splits: SplitDraft[]): { personName: string; amount: number }[] {
  return splits
    .map((split) => ({
      personName: split.personName.trim(),
      amount: round2(Number(split.amount)),
    }))
    .filter((split) => split.personName.length > 0 && split.amount > 0);
}

/**
 * Names entered twice, lower-cased for comparison.
 *
 * Surfaced in the form rather than left to the server's `DUPLICATE_PERSON`
 * error, because by then the user has lost the round trip and the message names
 * only one of the two rows. Returns the offending names so the rows themselves
 * can be marked.
 */
export function duplicateNames(splits: SplitDraft[]): string[] {
  const seen = new Map<string, number>();
  for (const split of splits) {
    const key = split.personName.trim().toLowerCase();
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}
