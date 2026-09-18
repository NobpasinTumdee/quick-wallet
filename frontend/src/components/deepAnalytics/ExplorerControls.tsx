import { BarChart3, BoxSelect, LineChart, ScatterChart, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../Icon';
import { TranslationKey } from '../../locales';
import {
  ACCEPTS,
  Aggregation,
  ChartSpec,
  ChartType,
  ColumnKind,
  DateBucket,
  RAW_SOURCES,
  RawColumn,
  RawSource,
  Role,
  usesAggregation,
  usesDateBucket,
} from '../../lib/explorerData';

/**
 * The variable-assignment panel: source, chart form, and which column goes on
 * which role — the JMP "cast columns into roles" idea.
 *
 * Each role's dropdown lists only the columns that role accepts for the chosen
 * chart. A scatter's X offers numbers and dates, a bar's X offers categories.
 * Filtering at the source means an impossible mapping cannot be built, rather
 * than being buildable and then explained as an error.
 */

const CHARTS: { type: ChartType; labelKey: TranslationKey; icon: LucideIcon }[] = [
  { type: 'bar', labelKey: 'explorer.chartBar', icon: BarChart3 },
  { type: 'line', labelKey: 'explorer.chartLine', icon: LineChart },
  { type: 'scatter', labelKey: 'explorer.chartScatter', icon: ScatterChart },
  { type: 'box', labelKey: 'explorer.chartBox', icon: BoxSelect },
];

const AGGREGATIONS: { value: Aggregation; labelKey: TranslationKey }[] = [
  { value: 'sum', labelKey: 'explorer.aggSum' },
  { value: 'mean', labelKey: 'explorer.aggMean' },
  { value: 'median', labelKey: 'explorer.aggMedian' },
  { value: 'count', labelKey: 'explorer.aggCount' },
];

const BUCKETS: { value: DateBucket; labelKey: TranslationKey }[] = [
  { value: 'day', labelKey: 'explorer.bucketDay' },
  { value: 'month', labelKey: 'explorer.bucketMonth' },
  { value: 'year', labelKey: 'explorer.bucketYear' },
];

export const SOURCE_LABEL: Record<RawSource, TranslationKey> = {
  transactions: 'explorer.sourceTransactions',
  investments: 'explorer.sourceInvestments',
  debts: 'explorer.sourceDebts',
  goals: 'explorer.sourceGoals',
  subscriptions: 'explorer.sourceSubscriptions',
  budgets: 'explorer.sourceBudgets',
  billSplits: 'explorer.sourceBillSplits',
  wallets: 'explorer.sourceWallets',
  watchlist: 'explorer.sourceWatchlist',
};

const KIND_LABEL: Record<ColumnKind, TranslationKey> = {
  number: 'explorer.kindNumber',
  date: 'explorer.kindDate',
  category: 'explorer.kindCategory',
  boolean: 'explorer.kindBoolean',
};

export function ExplorerControls({
  source,
  onSource,
  columns,
  spec,
  onSpec,
  onChartType,
  disabled,
}: {
  source: RawSource;
  onSource: (source: RawSource) => void;
  columns: RawColumn[];
  spec: ChartSpec;
  onSpec: (patch: Partial<ChartSpec>) => void;
  onChartType: (type: ChartType) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const countOnly = usesAggregation(spec.type) && spec.aggregation === 'count';

  /** A role's picker, filtered to the kinds it accepts for this chart. */
  function rolePicker(role: Role, labelKey: TranslationKey, optional: boolean) {
    const kinds = ACCEPTS[spec.type][role];
    if (!kinds) return null;
    const options = columns.filter((column) => kinds.includes(column.kind));
    const id = `xp-role-${role}`;

    return (
      <div className="xp-field">
        <label htmlFor={id}>
          {t(labelKey)}
          <small>{kinds.map((kind) => t(KIND_LABEL[kind])).join(' · ')}</small>
        </label>
        <select
          id={id}
          value={spec[role] ?? ''}
          disabled={disabled || options.length === 0}
          onChange={(event) => onSpec({ [role]: event.target.value || null } as Partial<ChartSpec>)}
        >
          {optional && <option value="">{t('explorer.none')}</option>}
          {!optional && !spec[role] && <option value="">{t('explorer.choose')}</option>}
          {options.map((column) => (
            <option key={column.key} value={column.key}>
              {column.header}
            </option>
          ))}
        </select>
        {options.length === 0 && <p className="xp-field-hint">{t('explorer.noColumnsForRole')}</p>}
      </div>
    );
  }

  return (
    <div className="xp-controls">
      <div className="xp-field">
        <label htmlFor="xp-source">{t('explorer.dataSource')}</label>
        <select
          id="xp-source"
          value={source}
          onChange={(event) => onSource(event.target.value as RawSource)}
        >
          {RAW_SOURCES.map((id) => (
            <option key={id} value={id}>
              {t(SOURCE_LABEL[id])}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="xp-field xp-charts" disabled={disabled}>
        <legend>{t('explorer.chartType')}</legend>
        <div className="xp-chart-grid">
          {CHARTS.map((chart) => (
            <button
              key={chart.type}
              type="button"
              className={spec.type === chart.type ? 'is-active' : undefined}
              aria-pressed={spec.type === chart.type}
              onClick={() => onChartType(chart.type)}
            >
              <Icon icon={chart.icon} size="sm" />
              {t(chart.labelKey)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="xp-roles">
        {rolePicker('x', 'explorer.roleX', false)}
        {countOnly ? (
          <div className="xp-field">
            <label>{t('explorer.roleY')}</label>
            <p className="xp-field-static">{t('explorer.countNeedsNoY')}</p>
          </div>
        ) : (
          rolePicker('y', 'explorer.roleY', false)
        )}
        {rolePicker('group', 'explorer.roleGroup', true)}
      </div>

      {usesAggregation(spec.type) && (
        <div className="xp-field">
          <label htmlFor="xp-agg">{t('explorer.aggregation')}</label>
          <select
            id="xp-agg"
            value={spec.aggregation}
            disabled={disabled}
            onChange={(event) => onSpec({ aggregation: event.target.value as Aggregation })}
          >
            {AGGREGATIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {t(a.labelKey)}
              </option>
            ))}
          </select>
        </div>
      )}

      {usesDateBucket(spec, columns) && (
        <div className="xp-field">
          <label htmlFor="xp-bucket">{t('explorer.dateBucket')}</label>
          <select
            id="xp-bucket"
            value={spec.dateBucket}
            disabled={disabled}
            onChange={(event) => onSpec({ dateBucket: event.target.value as DateBucket })}
          >
            {BUCKETS.map((b) => (
              <option key={b.value} value={b.value}>
                {t(b.labelKey)}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
