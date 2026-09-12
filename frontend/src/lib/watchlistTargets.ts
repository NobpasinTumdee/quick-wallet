/**
 * Where a live price sits relative to a watchlist target.
 *
 * Pure, and in `lib/` rather than in the hook, for the same reason the tax
 * bands and the DCA averaging live here: it is the part someone will want to
 * check, and it should be checkable without mounting React.
 */

export type TargetState = 'none' | 'above' | 'near' | 'below';

export interface TargetProximity {
  state: TargetState;
  /** Signed % the live price sits from the target. Positive = above it. */
  distancePercent: number;
}

/** Inside this band of the target counts as "near" — worth a glance. */
export const NEAR_BAND_PERCENT = 3;

/**
 * Deliberately does not judge the direction.
 *
 * A target below the market is someone waiting for a dip; a target above it is
 * someone waiting for a breakout. The same 10% gap is good news in one case and
 * bad in the other, and only the user knows which they meant — so this reports
 * the distance and lets the UI colour proximity, never direction.
 */
export function targetProximity(price: number, targetPrice: number): TargetProximity {
  if (!(targetPrice > 0) || !(price > 0)) return { state: 'none', distancePercent: 0 };

  const distancePercent = ((price - targetPrice) / targetPrice) * 100;
  if (Math.abs(distancePercent) <= NEAR_BAND_PERCENT) return { state: 'near', distancePercent };

  return { state: distancePercent > 0 ? 'above' : 'below', distancePercent };
}
