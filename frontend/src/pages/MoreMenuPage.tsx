import {
  ChartNoAxesCombined,
  CreditCard,
  HandCoins,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  Repeat2,
  Settings,
  Target,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MenuCard } from '../components/MenuCard';
import { TranslationKey } from '../locales';
import { Route } from '../lib/router';

/**
 * The app directory — every screen in one place.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The phone has two navigation surfaces and both are full. The tab bar holds
 * four routes before the touch targets drop under 44px; the gesture arc holds
 * five before the items overlap at 320px — a hard geometric ceiling, not a
 * style preference (see `arcRadius` in GestureNavWidget). That is nine slots
 * for an app that now has twelve screens, and the next feature makes it
 * thirteen.
 *
 * Spending the arc's last slot on a door to *all* of them trades one shortcut
 * for an entry point that never runs out. The four that stay in the arc are the
 * ones worth a single gesture; everything else is one tap further away and, for
 * the first time, actually listed somewhere.
 *
 * ---------------------------------------------------------------------------
 * WHY GROUPED, AND WHY THESE GROUPS
 * ---------------------------------------------------------------------------
 * Twelve undifferentiated rows is a list you scan linearly every time. The
 * grouping is by *what you came to do*, which is the question someone opening a
 * directory is actually answering — not by how the data is stored and not
 * alphabetically, which only helps when you already know the name.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY ROUTE IS HERE, INCLUDING THE ONES WITH THEIR OWN SLOT
 * ---------------------------------------------------------------------------
 * Overview and Activity have permanent tabs, so listing them again is
 * redundant — right up until it isn't. A directory that holds *most* screens
 * cannot be trusted to answer "does this app do X", because a miss proves
 * nothing. The duplication costs two rows; the alternative costs the page its
 * only real job.
 */

interface MenuEntry {
  route: Route;
  /** Reuses the nav label, so a screen has one name everywhere. */
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
}

interface MenuSection {
  id: string;
  titleKey: TranslationKey;
  hintKey: TranslationKey;
  entries: MenuEntry[];
}

/* Module-level, and therefore keys rather than strings — see the note in
   MenuCard on why a translated string cannot live in a table like this. */
const SECTIONS: MenuSection[] = [
  {
    id: 'core',
    titleKey: 'more.sectionCore',
    hintKey: 'more.sectionCoreHint',
    entries: [
      {
        route: 'dashboard',
        labelKey: 'nav.dashboard',
        descriptionKey: 'more.dashboard',
        icon: LayoutDashboard,
      },
      { route: 'wallets', labelKey: 'nav.wallets', descriptionKey: 'more.wallets', icon: Wallet },
      {
        route: 'transactions',
        labelKey: 'nav.transactions',
        descriptionKey: 'more.transactions',
        icon: Receipt,
      },
      { route: 'cards', labelKey: 'nav.cards', descriptionKey: 'more.cards', icon: CreditCard },
    ],
  },
  {
    id: 'tracking',
    titleKey: 'more.sectionTracking',
    hintKey: 'more.sectionTrackingHint',
    entries: [
      {
        route: 'investments',
        labelKey: 'nav.investments',
        descriptionKey: 'more.investments',
        icon: TrendingUp,
      },
      {
        route: 'analytics',
        labelKey: 'nav.analytics',
        descriptionKey: 'more.analytics',
        icon: ChartNoAxesCombined,
      },
      { route: 'splits', labelKey: 'nav.splits', descriptionKey: 'more.splits', icon: HandCoins },
    ],
  },
  {
    id: 'planning',
    titleKey: 'more.sectionPlanning',
    hintKey: 'more.sectionPlanningHint',
    entries: [
      { route: 'goals', labelKey: 'nav.goals', descriptionKey: 'more.goals', icon: PiggyBank },
      { route: 'budgets', labelKey: 'nav.budgets', descriptionKey: 'more.budgets', icon: Target },
      {
        route: 'subscriptions',
        labelKey: 'nav.subscriptions',
        descriptionKey: 'more.subscriptions',
        icon: Repeat2,
      },
    ],
  },
  {
    id: 'app',
    titleKey: 'more.sectionApp',
    hintKey: 'more.sectionAppHint',
    entries: [
      { route: 'settings', labelKey: 'nav.settings', descriptionKey: 'more.settings', icon: Settings },
    ],
  },
];

export function MoreMenuPage({
  onNavigate,
  onPrefetch,
}: {
  onNavigate: (route: Route) => void;
  /** Warms a destination's data. Supplied by the shell, which owns the period. */
  onPrefetch?: (route: Route) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="stack more">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="section-label">{t('nav.more')}</span>
          <h1 className="page-title">{t('more.title')}</h1>
          <p className="page-lede">{t('more.lede')}</p>
        </div>
      </div>

      {SECTIONS.map((section) => (
        /* A real <section> with a labelled heading, so a screen reader can jump
           between groups instead of walking twelve buttons in a row. */
        <section key={section.id} className="more-section" aria-labelledby={`more-${section.id}`}>
          <div className="more-section-head">
            <h2 className="more-section-title" id={`more-${section.id}`}>
              {t(section.titleKey)}
            </h2>
            <p className="more-section-hint">{t(section.hintKey)}</p>
          </div>

          <div className="more-grid">
            {section.entries.map((entry) => (
              <MenuCard
                key={entry.route}
                labelKey={entry.labelKey}
                descriptionKey={entry.descriptionKey}
                icon={entry.icon}
                onClick={() => onNavigate(entry.route)}
                onPrefetch={onPrefetch ? () => onPrefetch(entry.route) : undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
