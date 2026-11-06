import type { TranslationKey } from '../../locales/en';
import type { GridCardDef } from './gridModel';

/**
 * Every card a customisable page can show, in one place.
 *
 * Each entry says what the card is called in the editors (the Customize
 * panel, the Arrange sheet, Settings — names unambiguous across pages, so
 * the Analytics cash-flow diagram is never mistaken for Home's income-vs-
 * spending chart), how big it may be on the desktop grid, whether it is one
 * of the two half cards side by side on a tablet, and on which pages it
 * appears. A page's registry is its slice of the catalog, in the page's own
 * default order.
 *
 * Sizes are columns of 12 and rows of 40px (gridModel.ts). `widths` and
 * `minPx` are the first layout format's terms (layoutModel.ts), still how a
 * layout nobody has placed is drawn; `minPx` is never more than the default
 * width measures at 1000px (Home and Analytics both have a 684px-wide grid
 * there), so a default layout is never stepped up.
 *
 * Pure: no React, no icons (cardIcons.ts), so the tests load it directly.
 */

export type HomeCardId = 'budgets' | 'wallets' | 'cashflow' | 'breakdown' | 'recent' | 'inbox' | 'analytics';

export type AnalyticsCardId =
  | 'bills'
  | 'savingsRate'
  | 'categoryPie'
  | 'categoryTree'
  | 'spendHeatmap'
  | 'categoryBoxplot'
  | 'payees'
  | 'sankey'
  | 'projection';

export type CatalogCardId = HomeCardId | AnalyticsCardId;

export interface CatalogCardDef<Id extends string = CatalogCardId> extends GridCardDef<Id> {
  /** The card's name wherever it is listed rather than shown. */
  titleKey: TranslationKey;
}

/**
 * Home's cards, in today's order and at today's sizes.
 *
 * Widths are columns of 12. The defaults reproduce the old 6-column bento
 * exactly (every span doubled): Budget 8 + Wallets 4, the chart full, the
 * two lists 6 + 6, then the inbox and the Analytics link full width.
 *
 * `minPx` was measured, not guessed. Wallets at 200px is the tightest; that
 * is what it gets today at 1000px (212px).
 *
 * Grid sizes (free placement): `minW` columns, `minH`–`maxH` rows of 40px.
 * `defaultH` is today's height at 1280px with typical data, rounded to rows
 * (Budget 565px → 9, Wallets 440 → 7, Cash flow 572 → 9, Where it went
 * 419 → 7, Recent 609 → 10, Inbox 168 → 3, Analytics 170 → 3). The minimums
 * keep a header and the first rows of content: two budgets, one wallet group,
 * the inbox's add form, and for Cash flow its stats and legend plus a 140px
 * plot at 1280px (68 + 48 + 186 + 140 = 442px, so 8 rows).
 *
 * Adding a card later: add it here, at the position it should take. Saved
 * layouts that predate it get it at that position too (`sanitizeLayout`), or
 * at the first free spot in a placed layout (`sanitizeGridLayout`).
 */
export const HOME_CATALOG: readonly CatalogCardDef<HomeCardId>[] = [
  { id: 'budgets', titleKey: 'dashboard.budgetProgress', widths: [4, 6, 8, 12], minPx: 320, defaultW: 8, heights: ['normal', 'tall'], minW: 4, minH: 5, maxH: 16, defaultH: 9 },
  { id: 'wallets', titleKey: 'dashboard.walletsTitle', widths: [3, 4, 6, 8, 12], minPx: 200, defaultW: 4, minW: 3, minH: 4, maxH: 16, defaultH: 7 },
  { id: 'cashflow', titleKey: 'layout.cardCashflow', widths: [6, 8, 12], minPx: 420, defaultW: 12, heights: ['normal', 'tall'], minW: 6, minH: 8, maxH: 14, defaultH: 9 },
  { id: 'breakdown', titleKey: 'dashboard.breakdownTitle', widths: [4, 6, 8, 12], minPx: 300, defaultW: 6, heights: ['normal', 'tall'], minW: 4, minH: 4, maxH: 16, defaultH: 7 },
  { id: 'recent', titleKey: 'dashboard.recentTitle', widths: [4, 6, 8, 12], minPx: 300, defaultW: 6, minW: 4, minH: 4, maxH: 16, defaultH: 10 },
  { id: 'inbox', titleKey: 'inbox.title', widths: [6, 8, 12], minPx: 360, defaultW: 12, minW: 6, minH: 3, maxH: 16, defaultH: 3 },
  { id: 'analytics', titleKey: 'analytics.title', widths: [3, 4, 6, 8, 12], minPx: 240, defaultW: 12, minW: 3, minH: 3, maxH: 3, defaultH: 3 },
];

/**
 * The Analytics page's cards, in today's order and at today's sizes: on the
 * old 6-column bento Bills, Savings rate, the box plot, the diagram and the
 * projection take the whole row and the other four a half each, so here
 * 12 and 6. (Today's grid back-fills: Top payees sits beside Spending by day,
 * ahead of the box plot. The default layout keeps that back-filling, so it
 * draws the same; see CardBoard.)
 *
 * Heights at 1280px with typical data, rounded to rows of 40px + 24px gaps.
 * Minimums keep each chart's axes and legend whole; fixed-shape content (the
 * day calendar) has a low maximum.
 */
export const ANALYTICS_CATALOG: readonly CatalogCardDef<AnalyticsCardId>[] = [
  { id: 'bills', titleKey: 'catalog.bills', widths: [8, 12], minPx: 560, defaultW: 12, minW: 8, minH: 5, maxH: 12, defaultH: 8 },
  { id: 'savingsRate', titleKey: 'catalog.savingsRate', widths: [4, 6, 8, 12], minPx: 300, defaultW: 12, minW: 4, minH: 4, maxH: 10, defaultH: 5 },
  { id: 'categoryPie', titleKey: 'catalog.categoryPie', widths: [4, 6, 8, 12], minPx: 300, defaultW: 6, minW: 4, minH: 6, maxH: 12, defaultH: 7 },
  { id: 'categoryTree', titleKey: 'catalog.categoryTree', widths: [4, 6, 8, 12], minPx: 300, defaultW: 6, minW: 4, minH: 4, maxH: 12, defaultH: 5 },
  { id: 'spendHeatmap', titleKey: 'catalog.spendHeatmap', widths: [4, 6, 8, 12], minPx: 300, defaultW: 6, minW: 4, minH: 5, maxH: 8, defaultH: 6 },
  { id: 'categoryBoxplot', titleKey: 'catalog.categoryBoxplot', widths: [6, 8, 12], minPx: 420, defaultW: 12, minW: 6, minH: 6, maxH: 12, defaultH: 7 },
  { id: 'payees', titleKey: 'catalog.payees', widths: [4, 6, 8, 12], minPx: 280, defaultW: 6, minW: 4, minH: 3, maxH: 16, defaultH: 6 },
  { id: 'sankey', titleKey: 'catalog.sankey', widths: [8, 12], minPx: 560, defaultW: 12, minW: 8, minH: 6, maxH: 14, defaultH: 8 },
  { id: 'projection', titleKey: 'catalog.projection', widths: [6, 8, 12], minPx: 420, defaultW: 12, minW: 6, minH: 6, maxH: 12, defaultH: 7 },
];

/** The cards drawn a half each, side by side, on a tablet (768–999px). */
export const HOME_TABLET_HALVES: ReadonlySet<HomeCardId> = new Set<HomeCardId>(['breakdown', 'recent']);
export const ANALYTICS_TABLET_HALVES: ReadonlySet<AnalyticsCardId> = new Set<AnalyticsCardId>([
  'categoryPie',
  'categoryTree',
  'spendHeatmap',
  'payees',
]);
