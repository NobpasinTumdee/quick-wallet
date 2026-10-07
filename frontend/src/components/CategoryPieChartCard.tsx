import { useTranslation } from 'react-i18next';

import { CategoryPieChart } from './CategoryPieChart';
import {
  AllTimeConfirm,
  CategoryChips,
  RangePicker,
  useCategoryExclusion,
} from './DistributionControls';
import { useDistributionRange } from '../hooks/useDistributionRange';
import { useMoneyFormatter } from '../state/SettingsContext';
import { Card, Skeleton } from './ui';

/**
 * The donut, the range it is drawn over, and which categories count.
 *
 * ---------------------------------------------------------------------------
 * WHY EXCLUSION FILTERS ROWS RATHER THAN HIDING SLICES
 * ---------------------------------------------------------------------------
 * Hiding a slice would leave the remaining shares adding up to less than 100%,
 * which is the one thing a proportion chart must never do. Excluding instead
 * removes the transactions before the composition is computed, so the total
 * shrinks and every other share grows to fill the circle. "Rent excluded" then
 * answers the question people actually ask — *of my discretionary spending*,
 * where does it go — rather than drawing the same picture with a bite out of
 * it.
 *
 * It also means the top-seven bucketing recomputes: drop the biggest category
 * and something buried in "Other" can earn its own slice, because it is now
 * genuinely one of the seven largest.
 *
 * The range picker, the all-time warning and the chips are shared with the
 * box plot card — see `DistributionControls`. Two copies of this would drift,
 * and worse, would stop sharing a cache key and quietly double the traffic.
 */
export function CategoryPieChartCard({
  period,
  className,
}: {
  period: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();

  const range = useDistributionRange(period);
  const otherLabel = t('analytics.categoriesOther');
  const exclusion = useCategoryExclusion(range.rows.items, otherLabel);

  return (
    <Card
      className={className}
      title={t('pie.title')}
      subtitle={t('pie.subtitle')}
      actions={<RangePicker state={range} />}
    >
      {range.rows.initialLoading ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <CategoryPieChart
            transactions={exclusion.visible}
            money={money}
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
