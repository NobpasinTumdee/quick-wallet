import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CategoryBoxPlot } from './CategoryBoxPlot';
import { useExcelDB } from '../hooks/useExcelDB';
import { formatPeriod, shiftPeriod } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Transaction } from '../types';
import { Button, Card, Skeleton } from './ui';

/**
 * The distribution chart, plus the one decision that keeps it usable: how much
 * data it is allowed to ask for.
 *
 * ---------------------------------------------------------------------------
 * WHY A YEAR IS OPT-IN
 * ---------------------------------------------------------------------------
 * A month is a few hundred transactions and a few hundred SVG circles. A year
 * is thousands of both, over a request that takes seconds against Apps Script.
 * Loading that by default would make the Analytics screen slow for everybody,
 * to serve a question most visits are not asking.
 *
 * So the month renders immediately and the year is a button. The distinction is
 * worth the extra tap: a month tells you what this month looked like, a year
 * tells you what is normal — and only the second one can say whether last
 * week's big purchase was actually unusual.
 *
 * ---------------------------------------------------------------------------
 * WHY THE YEAR QUERY IS ITS OWN CACHE KEY
 * ---------------------------------------------------------------------------
 * `from`/`to` are real server-side filters (see `transactionsList_`), so the
 * year is one scoped request rather than 2,000 unscoped rows filtered on the
 * client. It also keeps its own entry in the request cache: switching back to
 * the month and forward again is free, and the month view never pays for rows
 * the year needed.
 *
 * `enabled: false` until asked is what makes "opt-in" true rather than
 * decorative — without it the hook would fetch the year on mount and the button
 * would only be hiding an expense already incurred.
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
  const rangeLabel = showYear
    ? t('boxplot.rangeYear')
    : `${t('boxplot.rangeMonth')} · ${formatPeriod(period, locale)}`;

  return (
    <Card
      className={className}
      title={t('boxplot.title')}
      subtitle={t('boxplot.subtitle')}
      actions={
        showYear ? (
          <Button size="sm" variant="ghost" onClick={() => setShowYear(false)}>
            {t('boxplot.backToMonth')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => setShowYear(true)}>
            {t('boxplot.loadYear')}
          </Button>
        )
      }
    >
      {active.initialLoading ? (
        <Skeleton rows={5} />
      ) : (
        <CategoryBoxPlot
          transactions={active.items}
          money={money}
          locale={locale}
          rangeLabel={rangeLabel}
        />
      )}
    </Card>
  );
}
