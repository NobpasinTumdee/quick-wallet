import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CategoryPieChart } from './CategoryPieChart';
import { useExcelDB } from '../hooks/useExcelDB';
import { formatPeriod, shiftPeriod } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Transaction } from '../types';
import { Button, Card, Skeleton } from './ui';

/**
 * The donut, plus the range it is drawn over.
 *
 * The same month-default / year-on-demand contract the box plot card uses, and
 * deliberately the same `from`/`to` window: `useExcelDB` keys its cache on the
 * params, so when both cards are showing the year they share one request rather
 * than making two identical ones. Keeping the two windows in step is what makes
 * that true — a different `limit` here would silently double the traffic.
 */
export function CategoryPieChartCard({
  period,
  className,
}: {
  period: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const locale = settings.locale;

  const [showYear, setShowYear] = useState(false);

  const monthRows = useExcelDB<Transaction>('transactions', { period });

  /* Twelve months back from the start of the displayed month, inclusive. */
  const yearRange = useMemo(() => {
    const from = `${shiftPeriod(period, -11)}-01`;
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return { from, to: `${period}-${String(lastDay).padStart(2, '0')}` };
  }, [period]);

  const yearRows = useExcelDB<Transaction>(
    'transactions',
    { from: yearRange.from, to: yearRange.to, limit: 5000 },
    { enabled: showYear },
  );

  const active = showYear ? yearRows : monthRows;
  const rangeLabel = showYear ? t('pie.rangeYear') : formatPeriod(period, locale);

  return (
    <Card
      className={className}
      title={t('pie.title')}
      subtitle={t('pie.subtitle')}
      actions={
        showYear ? (
          <Button size="sm" variant="ghost" onClick={() => setShowYear(false)}>
            {t('pie.backToMonth')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => setShowYear(true)}>
            {t('pie.loadYear')}
          </Button>
        )
      }
    >
      {active.initialLoading ? (
        <Skeleton rows={4} />
      ) : (
        <CategoryPieChart
          transactions={active.items}
          money={money}
          rangeLabel={rangeLabel}
        />
      )}
    </Card>
  );
}
