import type { TranslationKey } from '../../locales/en';
import type { CardDef } from './layoutModel';

/**
 * Desktop Home's cards, in today's order and at today's sizes.
 *
 * Widths are columns of 12. The defaults reproduce the old 6-column bento
 * exactly (every span doubled): Budget 8 + Wallets 4, the chart full, the
 * two lists 6 + 6, then the inbox and the Analytics link full width.
 *
 * `minPx` was measured, not guessed: it is never more than the default width
 * comes to at 1000px — the narrowest desktop, where the page is 684px wide —
 * so the default layout is never stepped up. Wallets at 200px is the tightest;
 * that is what it gets today at 1000px (212px).
 *
 * Adding a card later: add it here, at the position it should take. Saved
 * layouts that predate it get it at that position too (`sanitizeLayout`).
 */
export type HomeCardId = 'budgets' | 'wallets' | 'cashflow' | 'breakdown' | 'recent' | 'inbox' | 'analytics';

export interface HomeCardDef extends CardDef<HomeCardId> {
  titleKey: TranslationKey;
}

export const HOME_CARDS: readonly HomeCardDef[] = [
  { id: 'budgets', titleKey: 'dashboard.budgetProgress', widths: [4, 6, 8, 12], minPx: 320, defaultW: 8, heights: ['normal', 'tall'] },
  { id: 'wallets', titleKey: 'dashboard.walletsTitle', widths: [3, 4, 6, 8, 12], minPx: 200, defaultW: 4 },
  { id: 'cashflow', titleKey: 'layout.cardCashflow', widths: [6, 8, 12], minPx: 420, defaultW: 12, heights: ['normal', 'tall'] },
  { id: 'breakdown', titleKey: 'dashboard.breakdownTitle', widths: [4, 6, 8, 12], minPx: 300, defaultW: 6, heights: ['normal', 'tall'] },
  { id: 'recent', titleKey: 'dashboard.recentTitle', widths: [4, 6, 8, 12], minPx: 300, defaultW: 6 },
  { id: 'inbox', titleKey: 'inbox.title', widths: [6, 8, 12], minPx: 360, defaultW: 12 },
  { id: 'analytics', titleKey: 'analytics.title', widths: [3, 4, 6, 8, 12], minPx: 240, defaultW: 12 },
];

/** The layout's storage name; `qw.layout.<page>.<userId>` on this device. */
export const HOME_LAYOUT_PAGE = 'home';
