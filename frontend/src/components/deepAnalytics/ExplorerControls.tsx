import { BarChart3, BoxSelect, LineChart, Plus, ScatterChart, X, type LucideIcon } from 'lucide-react';
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
  MAX_X_VARS,
  RAW_SOURCES,
  RawColumn,
  RawSource,
  columnFor,
  maxYVars,
  seriesMode,
  usesAggregation,
  usesDateBucket,
} from '../../lib/explorerData';

/**
 * The control panel: source, chart form, and which columns are cast into which
 * role — JMP's "cast columns into roles", with Tableau's shelves for the lists.
 *
 *   X  · Y   — shelves of removable pills. Several X nest (outer to inner, in
 *              the order added); several Y share one axis and take the colour.
 *   Overlay  — one column, coloured. Paused while Y holds several variables.
 *   Page By  — one column, one panel per value, every panel on shared scales.
 *
 * Every picker lists only the columns its role accepts for the chosen chart,
 * and a shelf stops offering columns once it is full. An impossible mapping
 * cannot be built, rather than being buildable and then explained as an error.
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
  const accepts = ACCEPTS[spec.type];
  const countOnly = usesAggregation(spec.type) && spec.aggregation === 'count';
  const mode = seriesMode(spec);

  const kindsHint = (kinds: ColumnKind[]) => kinds.map((kind) => t(KIND_LABEL[kind])).join(' · ');
  const optionsFor = (kinds: ColumnKind[] | null) =>
    kinds ? columns.filter((column) => kinds.includes(column.kind)) : [];

  /** A single-column role: Overlay or Page By. */
  function singlePicker(
    role: 'overlay' | 'page',
    labelKey: TranslationKey,
    value: string | null,
    onChange: (next: string | null) => void,
    pausedHint: TranslationKey | null,
  ) {
    const kinds = accepts[role];
    const options = optionsFor(kinds);
    const id = `xp-role-${role}`;
    const hintId = `${id}-hint`;
    const unavailable = !kinds;
    const hint: TranslationKey | null = unavailable
      ? 'explorer.overlayNotForChart'
      : pausedHint ?? (role === 'page' ? 'explorer.pageHint' : null);

    return (
      <div className={pausedHint || unavailable ? 'xp-field is-paused' : 'xp-field'}>
        <label htmlFor={id}>
          {t(labelKey)}
          {kinds && <small>{kindsHint(kinds)}</small>}
        </label>
        <select
          id={id}
          value={unavailable ? '' : value ?? ''}
          disabled={disabled || unavailable || options.length === 0}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">{t('explorer.none')}</option>
          {options.map((column) => (
            <option key={column.key} value={column.key}>
              {column.header}
            </option>
          ))}
        </select>
        {hint && (
          <p className="xp-field-hint" id={hintId}>
            {t(hint)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="xp-controls">
      <div className="xp-field">
        <label htmlFor="xp-source">{t('explorer.dataSource')}</label>
        <select id="xp-source" value={source} onChange={(event) => onSource(event.target.value as RawSource)}>
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
        <VariableShelf
          role="x"
          label={t('explorer.roleX')}
          kindsHint={kindsHint(accepts.x ?? [])}
          columns={columns}
          options={optionsFor(accepts.x)}
          values={spec.xVars}
          max={MAX_X_VARS[spec.type]}
          disabled={disabled}
          hint={
            MAX_X_VARS[spec.type] === 1
              ? t('explorer.oneXForChart')
              : spec.xVars.length > 1
                ? t('explorer.nestHint')
                : null
          }
          onChange={(xVars) => onSpec({ xVars })}
        />

        {countOnly ? (
          <div className="xp-field">
            <span className="xp-field-label">{t('explorer.roleY')}</span>
            <p className="xp-field-static">{t('explorer.countNeedsNoY')}</p>
          </div>
        ) : (
          <VariableShelf
            role="y"
            label={t('explorer.roleY')}
            kindsHint={kindsHint(accepts.y ?? [])}
            columns={columns}
            options={optionsFor(accepts.y)}
            values={spec.yVars}
            max={maxYVars(spec.type)}
            disabled={disabled}
            hint={spec.yVars.length > 1 ? t('explorer.sharedYHint') : null}
            onChange={(yVars) => onSpec({ yVars })}
          />
        )}

        {singlePicker(
          'overlay',
          'explorer.roleOverlay',
          spec.overlay,
          (overlay) => onSpec({ overlay }),
          mode === 'metric' && spec.overlay ? 'explorer.overlayPausedForMetrics' : null,
        )}
        {singlePicker('page', 'explorer.rolePage', spec.pageBy, (pageBy) => onSpec({ pageBy }), null)}
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

/**
 * A shelf of variables: removable pills, then an "Add variable" picker.
 *
 * The picker is a native select whose value is always empty, so choosing an
 * option adds it and the control resets. That keeps the mobile OS picker and
 * native keyboard behaviour without a hand-built combobox. Once the shelf is
 * full the picker is disabled with the reason beside it, rather than hidden —
 * a control that vanishes gives no clue that a limit exists.
 *
 * A one-slot shelf (a scatter's X) is just a select: a pill you must remove
 * before you can choose again would be one step worse than a dropdown.
 */
function VariableShelf({
  role,
  label,
  kindsHint,
  columns,
  options,
  values,
  max,
  disabled,
  hint,
  onChange,
}: {
  role: 'x' | 'y';
  label: string;
  kindsHint: string;
  columns: RawColumn[];
  options: RawColumn[];
  values: string[];
  max: number;
  disabled: boolean;
  hint: string | null;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const id = `xp-role-${role}`;
  const hintId = `${id}-hint`;

  if (max === 1) {
    return (
      <div className="xp-field">
        <label htmlFor={id}>
          {label}
          <small>{kindsHint}</small>
        </label>
        <select
          id={id}
          value={values[0] ?? ''}
          disabled={disabled || options.length === 0}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}
        >
          {!values[0] && <option value="">{t('explorer.choose')}</option>}
          {options.map((column) => (
            <option key={column.key} value={column.key}>
              {column.header}
            </option>
          ))}
        </select>
        {options.length === 0 && <p className="xp-field-hint">{t('explorer.noColumnsForRole')}</p>}
        {hint && options.length > 0 && (
          <p className="xp-field-hint" id={hintId}>
            {hint}
          </p>
        )}
      </div>
    );
  }

  const remaining = options.filter((column) => !values.includes(column.key));
  const full = values.length >= max;

  return (
    <div className="xp-field" role="group" aria-labelledby={`${id}-label`}>
      <span className="xp-field-label" id={`${id}-label`}>
        {label}
        <small>{kindsHint}</small>
      </span>

      {values.length > 0 && (
        <ul className="xp-pills">
          {values.map((key, index) => {
            const name = columnFor(columns, key)?.header ?? key;
            return (
              <li key={key} className="xp-pill">
                {values.length > 1 && (
                  <span className="xp-pill-index" aria-hidden="true">
                    {index + 1}
                  </span>
                )}
                <span className="xp-pill-name">{name}</span>
                <button
                  type="button"
                  className="xp-pill-remove"
                  disabled={disabled}
                  aria-label={t('explorer.removeVariable', { name })}
                  onClick={() => onChange(values.filter((value) => value !== key))}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="xp-pill-add">
        <Icon icon={Plus} size="sm" />
        <select
          id={id}
          value=""
          aria-label={`${t('explorer.addVariable')} — ${label}`}
          aria-describedby={full || hint ? hintId : undefined}
          disabled={disabled || full || remaining.length === 0}
          onChange={(event) => {
            if (event.target.value) onChange([...values, event.target.value]);
          }}
        >
          <option value="">{values.length === 0 ? t('explorer.choose') : t('explorer.addVariable')}</option>
          {remaining.map((column) => (
            <option key={column.key} value={column.key}>
              {column.header}
            </option>
          ))}
        </select>
      </div>

      {options.length === 0 ? (
        <p className="xp-field-hint">{t('explorer.noColumnsForRole')}</p>
      ) : full ? (
        <p className="xp-field-hint" id={hintId}>
          {t('explorer.maxVarsReached', { max })}
        </p>
      ) : hint ? (
        <p className="xp-field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
