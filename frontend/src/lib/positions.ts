/**
 * Lots → holdings.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL
 * ---------------------------------------------------------------------------
 * A **lot** is one purchase: 3 AAPL at 190 on 12 March, with its own fees. It
 * is one row in the Investments sheet and it is what gets sold.
 *
 * A **holding** is what the user calls "my Apple position": every open lot of
 * the same symbol in the same wallet, rolled up into one line with a blended
 * average cost. Dollar-cost averaging is the whole point — buy the same ticker
 * every month and the only number that means anything is the average.
 *
 * Lots are never merged in storage. Merging would destroy the purchase history,
 * make partial sales impossible to price, and quietly rewrite the cost basis of
 * a position every time it was topped up. So the sheet keeps rows and this
 * module does the arithmetic on read.
 *
 * ---------------------------------------------------------------------------
 * WHY THE AVERAGE IS COST BASIS ÷ SHARES
 * ---------------------------------------------------------------------------
 * Not the mean of the buy prices. A mean of prices ignores how many shares were
 * bought at each one — 1 share at 100 and 99 shares at 200 averages to 150 by
 * that method and 199 by the correct one. Fees are included for the same reason
 * the server includes them in `costBasis`: they are money spent to own the
 * shares, and leaving them out overstates P&L by exactly the commission.
 *
 * This module is a leaf: it imports types only. `useStockQuotes` imports *from*
 * here, never the reverse.
 */

import { Investment, Quote } from '../types';

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/**
 * The valuation fields `useStockQuotes` layers onto a lot.
 *
 * Declared here rather than imported from the hook so this file stays a leaf.
 * `PositionValuation` extends it, which keeps the two definitions welded.
 */
export interface LotValuation {
  quote: Quote | null;
  /** Price in the market's own currency, e.g. 210.00 USD. */
  nativePrice: number;
  nativeCurrency: string;
  /** Multiplier applied to reach the bookkeeping currency. 1 when they match. */
  fxRate: number;
  converted: boolean;
  /** Price in the bookkeeping currency. */
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

export interface Holding<T extends Investment = Investment> {
  /** `<walletId>::<SYMBOL>` — the same key `positionKey_` builds in Code.gs. */
  key: string;
  symbol: string;
  walletId: string;
  /** Newest purchase first, matching how the Activity list reads. */
  lots: T[];
  /** Σ shares across every lot. */
  quantity: number;
  /** Σ (shares × price) + fees. The denominator of every percentage below. */
  costBasis: number;
  fees: number;
  /** The DCA number: `costBasis / quantity`, fees included. */
  avgCost: number;
  /**
   * Cheapest and dearest per-share price paid, fees excluded — the spread the
   * averaging actually smoothed out.
   */
  lowestBuyPrice: number;
  highestBuyPrice: number;
  firstBuyDate: string;
  lastBuyDate: string;
  /** Union of every lot's tags, in first-seen order. */
  tagList: string[];
}

/**
 * A holding priced against a live quote. Lot-level price fields are shared
 * across the lots of one symbol, so they lift to the holding unchanged.
 */
export interface ValuedHolding<T extends Investment & LotValuation = Investment & LotValuation>
  extends Holding<T>,
    LotValuation {}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

/**
 * The grouping key, with a fallback.
 *
 * `/api/investments` returns `positionKey` from the server. `/api/dashboard`
 * returns rows through the same decorator, so it has one too — but a payload
 * cached before this field existed does not, and neither does an optimistic row
 * invented on the client a moment ago. Rebuilding it from the same two fields
 * the server uses keeps those cases grouping correctly instead of each showing
 * up as its own holding.
 */
export function positionKeyOf(row: Pick<Investment, 'walletId' | 'symbol' | 'positionKey'>): string {
  return row.positionKey || `${row.walletId ?? ''}::${String(row.symbol ?? '').toUpperCase()}`;
}

/** Guards against a lot whose quantity is zero or junk, which would divide by 0. */
function sharesOf(lot: Investment): number {
  const quantity = Number(lot.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function costOf(lot: Investment): number {
  // Prefer the server's figure; recompute only when it is absent (dashboard
  // payloads, optimistic rows) so there is one definition of cost basis.
  if (Number.isFinite(lot.costBasis) && lot.costBasis > 0) return lot.costBasis;
  return sharesOf(lot) * (Number(lot.buyPrice) || 0) + (Number(lot.fees) || 0);
}

/**
 * Rolls lots up into holdings, most recently topped-up first.
 *
 * Pass only the lots you want grouped — open lots for the portfolio view. Sold
 * lots stay per-lot on purpose: a closed lot's realised P&L is meaningful on its
 * own, and averaging it into a holding would lose it.
 */
export function groupHoldings<T extends Investment>(rows: T[]): Holding<T>[] {
  const byKey = new Map<string, Holding<T>>();

  for (const row of rows) {
    const key = positionKeyOf(row);
    let holding = byKey.get(key);

    if (!holding) {
      holding = {
        key,
        symbol: String(row.symbol ?? '').toUpperCase(),
        walletId: row.walletId,
        lots: [],
        quantity: 0,
        costBasis: 0,
        fees: 0,
        avgCost: 0,
        lowestBuyPrice: Infinity,
        highestBuyPrice: 0,
        firstBuyDate: row.buyDate,
        lastBuyDate: row.buyDate,
        tagList: [],
      };
      byKey.set(key, holding);
    }

    holding.lots.push(row);
    holding.quantity += sharesOf(row);
    holding.costBasis += costOf(row);
    holding.fees += Number(row.fees) || 0;

    const price = Number(row.buyPrice) || 0;
    if (price > 0) {
      holding.lowestBuyPrice = Math.min(holding.lowestBuyPrice, price);
      holding.highestBuyPrice = Math.max(holding.highestBuyPrice, price);
    }

    // Date keys are `YYYY-MM-DD`, so a lexical compare is chronological.
    if (row.buyDate && row.buyDate < holding.firstBuyDate) holding.firstBuyDate = row.buyDate;
    if (row.buyDate && row.buyDate > holding.lastBuyDate) holding.lastBuyDate = row.buyDate;

    for (const tag of row.tagList ?? []) {
      if (!holding.tagList.includes(tag)) holding.tagList.push(tag);
    }
  }

  const holdings = [...byKey.values()];

  for (const holding of holdings) {
    holding.avgCost = holding.quantity > 0 ? holding.costBasis / holding.quantity : 0;
    if (holding.lowestBuyPrice === Infinity) holding.lowestBuyPrice = 0;
    holding.lots.sort((a, b) =>
      String(`${b.buyDate ?? ''}${b.createdAt ?? ''}`).localeCompare(
        String(`${a.buyDate ?? ''}${a.createdAt ?? ''}`),
      ),
    );
  }

  // The position you are actively building is the one you came to look at.
  return holdings.sort((a, b) => String(b.lastBuyDate).localeCompare(String(a.lastBuyDate)));
}

/**
 * Same grouping, plus the live figures.
 *
 * Every lot of one symbol was priced from the same quote at the same rate, so
 * price, currency and FX lift straight to the holding; only the money amounts
 * are summed. P&L percent is recomputed against the *blended* cost basis rather
 * than averaged from the lots — averaging percentages of different sizes is the
 * same error as averaging buy prices.
 */
export function groupValuedHoldings<T extends Investment & LotValuation>(
  rows: T[],
): ValuedHolding<T>[] {
  return groupHoldings(rows).map((holding) => {
    // The first lot carrying a quote defines the price for the whole holding;
    // if none resolved, fall back to the first lot so currency labels still read.
    const priced = holding.lots.find((lot) => lot.quote) ?? holding.lots[0];

    const marketValue = holding.lots.reduce((sum, lot) => sum + lot.marketValue, 0);
    const unrealizedPnl = holding.lots.reduce((sum, lot) => sum + lot.unrealizedPnl, 0);

    return {
      ...holding,
      quote: priced?.quote ?? null,
      nativePrice: priced?.nativePrice ?? 0,
      nativeCurrency: priced?.nativeCurrency ?? '',
      fxRate: priced?.fxRate ?? 1,
      converted: priced?.converted ?? false,
      marketPrice: priced?.marketPrice ?? 0,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent: holding.costBasis > 0 ? (unrealizedPnl / holding.costBasis) * 100 : 0,
    };
  });
}

/**
 * What the average cost becomes if you buy `shares` more at `pricePerShare`.
 *
 * Powers the live preview in the buy form. Adding to a position is the one
 * moment the blended average is about to move, and seeing where it lands is the
 * entire decision — a DCA buy is judged against the average, not the price.
 */
export function projectAverageCost(
  holding: Pick<Holding, 'quantity' | 'costBasis'> | null | undefined,
  shares: number,
  pricePerShare: number,
  fees = 0,
): { quantity: number; costBasis: number; avgCost: number; previousAvgCost: number; delta: number } {
  const heldQuantity = holding?.quantity ?? 0;
  const heldCost = holding?.costBasis ?? 0;
  const addedShares = Number.isFinite(shares) && shares > 0 ? shares : 0;
  const addedCost = addedShares * (Number(pricePerShare) || 0) + (Number(fees) || 0);

  const quantity = heldQuantity + addedShares;
  const costBasis = heldCost + addedCost;
  const avgCost = quantity > 0 ? costBasis / quantity : 0;
  const previousAvgCost = heldQuantity > 0 ? heldCost / heldQuantity : 0;

  return {
    quantity,
    costBasis,
    avgCost,
    previousAvgCost,
    // Zero when there was nothing held before: there is no average to move.
    delta: previousAvgCost > 0 ? avgCost - previousAvgCost : 0,
  };
}
