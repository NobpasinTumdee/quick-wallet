import type { TranslationKey } from '../../locales/en';
import type { GridCardDef } from './gridModel';

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
 * Grid sizes (free placement): `minW` columns, `minH`–`maxH` rows of 40px.
 * `defaultH` is today's height at 1280px with typical data, rounded to rows
 * (Budget 565px → 9, Wallets 440 → 7, Cash flow 572 → 9, Where it went
 * 419 → 7, Recent 609 → 10, Inbox 168 → 3, Analytics 170 → 3). The minimums
 * keep a header and the first rows of content: two budgets, one wallet group,
 * the inbox's add form, and for Cash flow its stats and legend plus a 140px
 * plot at 1280px (68 + 48 + 186 + 140 = 442px, so 8 rows). On a narrower
 * screen its stats wrap; a narrow chart there scrolls inside its card.
 *
 * Adding a card later: add it here, at the position it should take. Saved
 * layouts that predate it get it at that position too (`sanitizeLayout`), or
 * at the first free spot in a placed layout (`sanitizeGridLayout`).
 */
export type HomeCardId = 'budgets' | 'wallets' | 'cashflow' | 'breakdown' | 'recent' | 'inbox' | 'analytics';

export interface HomeCardDef extends GridCardDef<HomeCardId> {
  titleKey: TranslationKey;
}

export const HOME_CARDS: readonly HomeCardDef[] = [
  { id: 'budgets', titleKey: 'dashboard.budgetProgress', widths: [4, 6, 8, 12], minPx: 320, defaultW: 8, heights: ['normal', 'tall'], minW: 4, minH: 5, maxH: 16, defaultH: 9 },
  { id: 'wallets', titleKey: 'dashboard.walletsTitle', widths: [3, 4, 6, 8, 12], minPx: 200, defaultW: 4, minW: 3, minH: 4, maxH: 16, defaultH: 7 },
  { id: 'cashflow', titleKey: 'layout.cardCashflow', widths: [6, 8, 12], minPx: 420, defaultW: 12, heights: ['normal', 'tall'], minW: 6, minH: 8, maxH: 14, defaultH: 9 },
  { id: 'breakdown', titleKey: 'dashboard.breakdownTitle', widths: [4, 6, 8, 12], minPx: 300, defaultW: 6, heights: ['normal', 'tall'], minW: 4, minH: 4, maxH: 16, defaultH: 7 },
  { id: 'recent', titleKey: 'dashboard.recentTitle', widths: [4, 6, 8, 12], minPx: 300, defaultW: 6, minW: 4, minH: 4, maxH: 16, defaultH: 10 },
  { id: 'inbox', titleKey: 'inbox.title', widths: [6, 8, 12], minPx: 360, defaultW: 12, minW: 6, minH: 3, maxH: 16, defaultH: 3 },
  { id: 'analytics', titleKey: 'analytics.title', widths: [3, 4, 6, 8, 12], minPx: 240, defaultW: 12, minW: 3, minH: 3, maxH: 3, defaultH: 3 },
];

/**
 * The layout's storage name: `qw.layout.<page>.<userId>` on this device and
 * `layout.<page>` on the server. Free placement has its own name, so the
 * first version's value — `home` — is only ever read (to migrate it), never
 * written, and a PC still running that version keeps its own copy.
 */
export const HOME_LAYOUT_PAGE = 'home-grid';
export const HOME_LEGACY_LAYOUT_PAGE = 'home';
