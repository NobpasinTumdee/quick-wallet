import { useTranslation } from 'react-i18next';

import { CategoryBoxPlot } from './CategoryBoxPlot';
import {
  AllTimeConfirm,
  CategoryChips,
  RangePicker,
  useCategoryExclusion,
} from './DistributionControls';
import { useDistributionRange } from '../hooks/useDistributionRange';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Card, Skeleton } from './ui';

/**
 * The distribution chart, plus the two controls that decide what it is of.
 *
 * ---------------------------------------------------------------------------
 * WHY A YEAR — AND ALL TIME — ARE OPT-IN
 * ---------------------------------------------------------------------------
 * A month is a few hundred transactions and a few hundred SVG circles. A year
 * is thousands of both, over a request that takes seconds against Apps Script;
 * all time is however long you have been using this. Loading either by default
 * would make Analytics slow for everybody, to answer a question most visits
 * are not asking.
 *
 * So the month renders immediately, the year is a tap, and all time asks
 * first. The distinction is worth it: a month tells you what this month looked
 * like, a year tells you what is normal — and only the second can say whether
 * last week's big purchase was actually unusual.
 *
 * ---------------------------------------------------------------------------
 * WHY EXCLUSION REMOVES COLUMNS RATHER THAN HIDING THEM
 * ---------------------------------------------------------------------------
 * On a box plot the reason is different from the donut's, and stronger. The
 * Y-axis is scaled to the largest value plotted, so one outsized category —
 * rent, a tax bill — flattens every other box into an unreadable sliver near
 * the floor. Dropping its rows rescales the axis to what is left, which is the
 * only way the remaining distributions become legible at all.
 *
 * It also reclaims the horizontal space: the plot lays columns out across the
 * categories it is given, so excluding two of five makes the other three
 * wider rather than leaving gaps.
 */
export function CategoryBoxPlotCard({
  period,
  className,
}: {
  period: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();

  const range = useDistributionRange(period);
  const otherLabel = t('analytics.categoriesOther');
  const exclusion = useCategoryExclusion(range.rows.items, otherLabel);

  return (
    <Card
      className={className}
      title={t('boxplot.title')}
      subtitle={t('boxplot.subtitle')}
      actions={<RangePicker state={range} />}
    >
      {range.rows.initialLoading ? (
        <Skeleton rows={5} />
      ) : (
        <>
          <CategoryBoxPlot
            /* The filtered rows: the plot derives its categories *and* its
               Y-axis maximum from whatever it is handed, so excluding a
               category rescales and relays out the whole chart with no
               further wiring. */
            transactions={exclusion.visible}
            money={money}
            locale={settings.locale}
            rangeLabel={range.label}
          />

          <CategoryChips
            categories={exclusion.categories}
            excluded={exclusion.excluded}
            money={money}
            onToggle={exclusion.toggle}
            onReset={exclusion.reset}
          />
        </>
      )}

      <AllTimeConfirm state={range} />
    </Card>
  );
}
