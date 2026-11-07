/**
 * The Income vs Spending chart's fixed sizes, shared with its skeleton so the
 * two take the same room (the skeleton must not import the chart itself: it
 * is a lazy chunk with Recharts).
 */

/** The plot's height in a card whose height is the content's own. */
export const CHART_HEIGHT = 268;
/** Room for two bars, two compact labels and a month tick without collisions. */
export const MONTH_WIDTH = 92;
/** Home's cash flow card drawn tall (a saved flow layout). */
export const TALL_CHART_HEIGHT = 400;
/** The months the chart shows on Home. */
export const HISTORY_MONTHS = 12;
