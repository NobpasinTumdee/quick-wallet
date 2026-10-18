import { BarChart3, ChevronRight, Receipt } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../Icon';
import { WalletIconRenderer } from '../WalletIconRenderer';
import { Button, Modal } from '../ui';
import { cx } from '../../lib/format';
import { GoalFilters, SpendBucket, SpendingSummary, goalPresetRange } from '../../lib/goalFilters';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';
import { WalletBalance } from '../../types';

/**
 * What the completed goals cost.
 *
 * ---------------------------------------------------------------------------
 * IT DESCRIBES THE FILTERED LIST, AND SAYS SO
 * ---------------------------------------------------------------------------
 * The figures are computed from exactly the goals on screen, so "spent on
 * completed goals this year, paid from KBank" is a filter rather than a second
 * set of controls. The scope line under the title states which goals and
 * which months the number covers — a total with no stated scope is the kind
 * of figure people quote wrongly.
 *
 * ---------------------------------------------------------------------------
 * ESTIMATES ARE NEVER MIXED IN SILENTLY
 * ---------------------------------------------------------------------------
 * When a purchase expense cannot be found, the goal's target stands in for
 * what it cost. The total is then prefixed "≈", and a line under it says how
 * many goals and how much of the figure are estimates.
 */
export function GoalSpendingSummary({
  summary,
  filters,
  filtered,
  wallets,
  desktop,
  loading,
}: {
  summary: SpendingSummary;
  filters: GoalFilters;
  /** True when any filter is narrowing the list. */
  filtered: boolean;
  wallets: WalletBalance[];
  desktop: boolean;
  /** The purchase expenses are still on their way. */
  loading: boolean;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();
  const { settings } = useSettings();
  const locale = settings.locale;
  const [sheetOpen, setSheetOpen] = useState(false);

  const estimated = summary.estimatedCount > 0;
  const approx = estimated ? '≈ ' : '';
  const scope = scopeLabel(summary, filters, locale, t('goals.spendScope', { count: summary.count }));

  const figures = (
    <div className="gs-figures">
      <div className="gs-figure gs-figure--total">
        <span className="section-label">{t('goals.spendTotal')}</span>
        <strong title={estimated ? t('goals.spendEstimatedTip') : undefined}>
          {approx}
          {money(summary.total)}
        </strong>
      </div>
      <div className="gs-figure">
        <span className="section-label">{t('goals.spendCount')}</span>
        <strong>{summary.count.toLocaleString(locale)}</strong>
      </div>
      <div className="gs-figure">
        <span className="section-label">{t('goals.spendAverage')}</span>
        <strong>
          {approx}
          {money(summary.average)}
        </strong>
      </div>
      <div className="gs-figure">
        <span className="section-label">{t('goals.spendVsTarget')}</span>
        <strong className={cx(summary.overTarget > 0 && 'is-over', summary.overTarget < 0 && 'is-under')}>
          {Math.abs(summary.overTarget) < 0.005
            ? t('goals.spendOnTarget')
            : summary.overTarget > 0
              ? t('goals.spendOver', { amount: money(summary.overTarget) })
              : t('goals.spendUnder', { amount: money(-summary.overTarget) })}
        </strong>
        <span className="gs-sub">{t('goals.spendTargetWas', { amount: money(summary.targetTotal) })}</span>
      </div>
    </div>
  );

  return (
    <section className={cx('gs', desktop ? 'gs--desktop' : 'gs--mobile')} aria-labelledby="gs-title">
      <header className="gs-head">
        <span className="gs-icon" aria-hidden="true">
          <Icon icon={Receipt} size="sm" />
        </span>
        <div className="gs-head-text">
          <h2 id="gs-title">{t('goals.spendTitle')}</h2>
          <p className="gs-scope">
            {summary.count === 0
              ? filtered
                ? t('goals.spendNoneFiltered')
                : t('goals.spendNone')
              : scope}
          </p>
        </div>
      </header>

      {summary.count > 0 && (
        <>
          {figures}

          {estimated && (
            <p className="gs-estimate" title={t('goals.spendEstimatedTip')}>
              {t('goals.spendEstimatedNote', {
                count: summary.estimatedCount,
                amount: money(summary.estimatedTotal),
              })}
            </p>
          )}
          {loading && <p className="gs-estimate">{t('goals.spendLoading')}</p>}

          {desktop ? (
            <SpendBreakdown summary={summary} wallets={wallets} locale={locale} />
          ) : (
            <>
              <button type="button" className="gs-more" onClick={() => setSheetOpen(true)}>
                <Icon icon={BarChart3} size="sm" />
                <span>{t('goals.spendBreakdown')}</span>
                <Icon icon={ChevronRight} size="sm" />
              </button>
              <Modal
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                title={t('goals.spendTitle')}
                footer={<Button onClick={() => setSheetOpen(false)}>{t('common.close')}</Button>}
              >
                <p className="gs-scope gs-scope--sheet">{scope}</p>
                <SpendBreakdown summary={summary} wallets={wallets} locale={locale} />
              </Modal>
            </>
          )}
        </>
      )}
    </section>
  );
}



function monthLabel(period: string, locale: string, withYear: boolean): string {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return period;
  return new Date(year, month - 1, 1).toLocaleDateString(locale, withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
}

/** "Jan–Oct 2026", or "Dec 2025 – Feb 2026" across a year boundary. */
function spanLabel(first: string, last: string, locale: string): string {
  if (!first || !last) return '';
  const a = first.slice(0, 7);
  const b = last.slice(0, 7);
  if (a === b) return monthLabel(a, locale, true);
  if (a.slice(0, 4) === b.slice(0, 4)) return `${monthLabel(a, locale, false)}–${monthLabel(b, locale, true)}`;
  return `${monthLabel(a, locale, true)} – ${monthLabel(b, locale, true)}`;
}

function scopeLabel(summary: SpendingSummary, filters: GoalFilters, locale: string, count: string): string {
  /* When the date filter is on purchase dates, its range is the honest span —
     "this year" even if the purchases happen to stop in March. */
  const range = filters.dateField === 'completed' ? goalPresetRange(filters) : null;
  const span = range && range.from && range.to ? spanLabel(range.from, range.to, locale) : spanLabel(summary.firstDate, summary.lastDate, locale);
  return span ? `${count} · ${span}` : count;
}

/**
 * Plain CSS bars — no chart library. recharts lives in its own lazy chunk,
 * and importing it from an eager page would pull all of it into the main
 * bundle for a dozen bars. These render in every theme from the same tokens.
 */
function SpendBreakdown({
  summary,
  wallets,
  locale,
}: {
  summary: SpendingSummary;
  wallets: WalletBalance[];
  locale: string;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();

  /* The last twelve months that had a purchase. Older ones are still in the
     total; a 40-column chart is not readable at any width. */
  const months = summary.byMonth.slice(-12);
  const monthMax = Math.max(1, ...months.map((m) => m.amount));
  const sameYear = months.length > 0 && months[0].key.slice(0, 4) === months[months.length - 1].key.slice(0, 4);

  const walletOf = (id: string) => wallets.find((w) => w.id === id);

  return (
    <div className="gs-breakdown">
      <div className="gs-block gs-block--months">
        <h3 className="gs-block-title">{t('goals.spendByMonth')}</h3>
        <ol className="gs-months" style={{ '--cols': months.length } as React.CSSProperties}>
          {months.map((bucket) => {
            const label = monthLabel(bucket.key, locale, !sameYear);
            return (
              <li key={bucket.key} className="gs-month" title={`${monthLabel(bucket.key, locale, true)} · ${money(bucket.amount)}`}>
                <span className="gs-month-value">{compactMoney(bucket.amount, locale)}</span>
                <span className="gs-month-track">
                  <span
                    className={cx('gs-month-bar', bucket.estimated && 'is-estimated')}
                    style={{ height: `${Math.max(4, (bucket.amount / monthMax) * 100)}%` }}
                  />
                </span>
                <span className="gs-month-label">{label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <BucketList
        title={t('goals.spendByCategory')}
        buckets={summary.byCategory}
        total={summary.total}
        label={(bucket) => bucket.key || t('goals.spendUnmatched')}
      />

      <BucketList
        title={t('goals.spendByWallet')}
        buckets={summary.byWallet}
        total={summary.total}
        label={(bucket) => (bucket.key ? walletOf(bucket.key)?.name ?? t('goals.unknownWallet') : t('goals.spendUnmatched'))}
        icon={(bucket) => {
          const wallet = bucket.key ? walletOf(bucket.key) : undefined;
          return wallet ? <WalletIconRenderer icon={wallet.icon} color={wallet.color} size="sm" /> : null;
        }}
      />
    </div>
  );
}

function BucketList({
  title,
  buckets,
  total,
  label,
  icon,
}: {
  title: string;
  buckets: SpendBucket[];
  total: number;
  label: (bucket: SpendBucket) => string;
  icon?: (bucket: SpendBucket) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();
  return (
    <div className="gs-block">
      <h3 className="gs-block-title">{title}</h3>
      <ul className="gs-list">
        {buckets.map((bucket) => {
          const share = total > 0 ? (bucket.amount / total) * 100 : 0;
          return (
            <li key={bucket.key || '—'} className="gs-row">
              <span className="gs-row-name">
                {icon?.(bucket)}
                <span className="gs-row-text" title={label(bucket)}>
                  {label(bucket)}
                </span>
              </span>
              <span className="gs-row-amount">
                {bucket.estimated && (
                  <abbr className="gs-approx" title={t('goals.spendEstimatedTip')}>
                    ≈
                  </abbr>
                )}
                {money(bucket.amount)}
              </span>
              <span className="gs-row-track" aria-hidden="true">
                <span className={cx('gs-row-bar', bucket.estimated && 'is-estimated')} style={{ width: `${share}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "12.5K" over a bar — the exact figure is in the row's tooltip. */
function compactMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
