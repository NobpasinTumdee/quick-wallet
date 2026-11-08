import {
  CalendarClock,
  CalendarDays,
  ChartCandlestick,
  ChartColumn,
  ChartNoAxesCombined,
  ChartPie,
  Inbox,
  ShieldCheck,
  Star,
  LayoutGrid,
  type LucideIcon,
  Percent,
  PiggyBank,
  Receipt,
  Store,
  TrendingUp,
  Wallet,
  Waypoints,
} from 'lucide-react';

import type { CatalogCardId } from './cardCatalog';

/** Each catalog card's icon in the editors (the Arrange sheet). Kept apart from
    the catalog so the catalog stays loadable by the tests without React. */
export const CARD_ICONS: Record<CatalogCardId, LucideIcon> = {
  budgets: PiggyBank,
  wallets: Wallet,
  cashflow: ChartColumn,
  breakdown: ChartPie,
  recent: Receipt,
  inbox: Inbox,
  analytics: ChartNoAxesCombined,
  favourites: Star,
  safeSpend: ShieldCheck,
  bills: CalendarClock,
  savingsRate: Percent,
  categoryPie: ChartPie,
  categoryTree: LayoutGrid,
  spendHeatmap: CalendarDays,
  categoryBoxplot: ChartCandlestick,
  payees: Store,
  sankey: Waypoints,
  projection: TrendingUp,
};
