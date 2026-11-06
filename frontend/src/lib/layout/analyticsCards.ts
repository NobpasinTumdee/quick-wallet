import { type AnalyticsCardId, type CatalogCardDef, ANALYTICS_CATALOG } from './cardCatalog';

/**
 * The Analytics page's slice of the card catalog (cardCatalog.ts) and the
 * names its layouts are stored under: `layout.analytics-grid` on desktop,
 * `layout.analytics-mobile` below 1000px — each its own key, as on Home.
 */
export type { AnalyticsCardId } from './cardCatalog';
export { ANALYTICS_TABLET_HALVES } from './cardCatalog';

export type AnalyticsCardDef = CatalogCardDef<AnalyticsCardId>;

export const ANALYTICS_CARDS: readonly AnalyticsCardDef[] = ANALYTICS_CATALOG;

export const ANALYTICS_LAYOUT_PAGE = 'analytics-grid';
export const ANALYTICS_ORDER_PAGE = 'analytics-mobile';
