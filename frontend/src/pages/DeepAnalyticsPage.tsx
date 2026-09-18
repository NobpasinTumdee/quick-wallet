import { AlertTriangle, ArrowLeft, ChevronDown, Database, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/* Imported here, not from app.css, so Vite emits it with this lazily loaded
   page. The main app never downloads it. */
import '../components/deepAnalytics/deepAnalytics.css';

import { Icon } from '../components/Icon';
import { ExplorerChart } from '../components/deepAnalytics/ExplorerChart';
import { ExplorerControls, SOURCE_LABEL } from '../components/deepAnalytics/ExplorerControls';
import { ExplorerFilters } from '../components/deepAnalytics/ExplorerFilters';
import { ExplorerLegend } from '../components/deepAnalytics/ExplorerLegend';
import { ExplorerTable } from '../components/deepAnalytics/ExplorerTable';
import { useExcelQuery } from '../hooks/useExcelDB';
import {
  Aggregation,
  BLANK,
  ChartSpec,
  ChartType,
  OTHER,
  RawDataset,
  RawSource,
  Series,
  SpecProblem,
  columnFor,
  defaultSpec,
  shapeData,
  tableTwin,
} from '../lib/explorerData';
import { Filter, applyFilters, isActive } from '../lib/explorerFilters';
import { formatBucket, formatExplorerNumber, formatInstant } from '../lib/explorerFormat';
import { OTHER_DARK, OTHER_LIGHT, isDarkSurface, seriesColor } from '../lib/explorerPalette';
import { cx } from '../lib/format';
import { Route } from '../lib/router';
import { TranslationKey } from '../locales';
import { useSettings } from '../state/SettingsContext';

/**
 * Deep Analytics — the raw-data explorer, as a page of its own.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LEFT THE MODAL
 * ---------------------------------------------------------------------------
 * A dialog was the right first shape: it kept the router flat and the feature
 * self-contained. It stopped being right once the explorer grew filters and a
 * colour editor. A chart builder is somewhere people stay and iterate, and a
 * dialog cannot be bookmarked, cannot be returned to with Back, and competes
 * with the page behind it for the same viewport. As a route it gets the whole
 * width, a URL, and ordinary browser history.
 *
 * ---------------------------------------------------------------------------
 * THE PIPELINE
 * ---------------------------------------------------------------------------
 *   raw rows ──filters──▶ filtered rows ──shapeData──▶ chart / table
 *        └───────── group ranking (colour identity) ─────────┘
 *
 * Filters run on raw rows, before anything is summarised: filtering sums would
 * answer a different question. Group colours are ranked on the *unfiltered*
 * rows, so hiding one group never repaints the others — see `groupSlots`.
 *
 * ---------------------------------------------------------------------------
 * STILL OUT OF THE MAIN BUNDLE
 * ---------------------------------------------------------------------------
 * This is the default export of a module AppShell reaches only through
 * `lazy()`, and only renders on this route. `bundlecheck.mjs` fails the build
 * if a static import ever pulls any of it back in.
 */

type View = 'chart' | 'twin' | 'raw';

const AGG_KEY: Record<Aggregation, TranslationKey> = {
  sum: 'explorer.aggSum',
  mean: 'explorer.aggMean',
  median: 'explorer.aggMedian',
  count: 'explorer.aggCount',
};
const VIEW_KEY: Record<View, TranslationKey> = {
  chart: 'explorer.viewChart',
  twin: 'explorer.viewTwin',
  raw: 'explorer.viewRaw',
};
const PROBLEM_KEY: Record<SpecProblem, TranslationKey> = {
  needX: 'explorer.problemNeedX',
  badX: 'explorer.problemBadX',
  needY: 'explorer.problemNeedY',
  badY: 'explorer.problemBadY',
  badGroup: 'explorer.problemBadGroup',
  tooManyBuckets: 'explorer.problemTooManyBuckets',
};
const CHART_KEY: Record<ChartType, TranslationKey> = {
  bar: 'explorer.chartBar',
  line: 'explorer.chartLine',
  scatter: 'explorer.chartScatter',
  box: 'explorer.chartBox',
};
const STAT_KEY: Record<string, TranslationKey> = {
  n: 'explorer.statN',
  min: 'explorer.statMin',
  q1: 'explorer.statQ1',
  median: 'explorer.statMedian',
  q3: 'explorer.statQ3',
  max: 'explorer.statMax',
};

/* ------------------------------------------------------------------ */
/* Colour choices, remembered per device                               */
/* ------------------------------------------------------------------ */

/**
 * `{ "transactions:type": { "expense": "#c0392b", … }, … }`
 *
 * Scoped by source *and* group column. "expense" coloured red while grouping
 * Transactions by Type says nothing about a group that happens to share the
 * name under a different column, and the colour must not follow it there.
 *
 * localStorage rather than the workbook: a chart colour is a view preference
 * of one screen on one device, and a Settings column for it would put a
 * cosmetic choice in the same row as the user's currency. Every access is
 * guarded — blocked storage just means the choice lasts for the session.
 */
type ColorMap = Record<string, Record<string, string>>;
const COLOR_KEY = 'quick-wallet.explorer-colors';

function readColors(): ColorMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLOR_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeColors(map: ColorMap): void {
  try {
    localStorage.setItem(COLOR_KEY, JSON.stringify(map));
  } catch {
    /* Quota or blocked storage — the colours last for this session. */
  }
}

export default function DeepAnalyticsPage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const locale = settings.locale;

  const [source, setSource] = useState<RawSource>('transactions');
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [view, setView] = useState<View>('chart');
  /* Per source, so switching to Debts and back restores the Transactions
     filters rather than discarding them or applying them to the wrong table. */
  const [filtersBySource, setFiltersBySource] = useState<Partial<Record<RawSource, Filter[]>>>({});
  const [colors, setColors] = useState<ColorMap>(readColors);
  /* Mobile only — the panel is always open beside the chart on a desktop. */
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => writeColors(colors), [colors]);

  /* On-demand by construction: this component does not exist until the route
     is visited, and `enabled` states the intent where the fetch is declared. */
  const query = useExcelQuery<RawDataset>('/api/analytics/raw-data', { source }, { enabled: true });
  const dataset = query.data && query.data.source === source ? query.data : null;

  const filters = filtersBySource[source] ?? [];
  const setFilters = useCallback(
    (next: Filter[]) => setFiltersBySource((previous) => ({ ...previous, [source]: next })),
    [source],
  );

  /* A new table means new columns: rebuild the spec against them, keeping
     whatever the previous one chose that the new table also has. */
  useEffect(() => {
    if (!dataset) return;
    setSpec((previous) => defaultSpec(previous?.type ?? 'bar', dataset.columns, previous ?? undefined));
  }, [dataset]);

  /* The painted surface — for the palette set and the contrast warning. Read
     rather than inferred from the theme name so `custom` works too. */
  const surface = useMemo(() => {
    if (typeof window === 'undefined') return '#111725';
    return getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#111725';
  }, [settings.theme, settings.customVars]);
  const dark = isDarkSurface(surface);

  /* ---- The pipeline ---- */
  const filtered = useMemo(() => (dataset ? applyFilters(dataset, filters) : null), [dataset, filters]);

  const scope = `${source}:${spec?.group ?? ''}`;
  const scopeColors = useMemo(() => (spec?.group ? colors[scope] ?? {} : {}), [colors, scope, spec?.group]);
  const customized = useMemo(() => new Set(Object.keys(scopeColors)), [scopeColors]);

  const result = useMemo(
    () =>
      dataset && filtered && spec
        ? shapeData(filtered, spec, { rankRows: dataset.rows, customColored: customized })
        : null,
    [dataset, filtered, spec, customized],
  );

  const colorOf = useCallback(
    (series: Series): string => {
      if (series.key === OTHER) return dark ? OTHER_DARK : OTHER_LIGHT;
      return scopeColors[series.key] ?? seriesColor(series.slot ?? 0, dark);
    },
    [scopeColors, dark],
  );

  function setColor(key: string, color: string) {
    setColors((previous) => ({ ...previous, [scope]: { ...(previous[scope] ?? {}), [key]: color } }));
  }
  function resetColor(key: string) {
    setColors((previous) => {
      const { [key]: _removed, ...rest } = previous[scope] ?? {};
      return { ...previous, [scope]: rest };
    });
  }
  function resetAllColors() {
    setColors((previous) => {
      const { [scope]: _removed, ...rest } = previous;
      return rest;
    });
  }

  /* ---- Labels ---- */
  const columnLabel = (key: string | null) => (dataset && columnFor(dataset.columns, key)?.header) ?? '';

  const categoryLabel = (key: string): string => {
    if (key === BLANK) return t('explorer.blank');
    if (key === OTHER) return t('explorer.other');
    if (key === 'true') return t('explorer.yes');
    if (key === 'false') return t('explorer.no');
    if (
      spec &&
      dataset &&
      columnFor(dataset.columns, spec.x)?.kind === 'date' &&
      /^\d{4}(-\d{2}){0,2}$/.test(key)
    ) {
      return formatBucket(key, spec.dateBucket, locale);
    }
    return key;
  };

  const seriesLabel = (key: string): string =>
    key === '' ? columnLabel(spec?.y ?? null) : categoryLabel(key);

  const yLabel =
    spec && (spec.type === 'bar' || spec.type === 'line')
      ? spec.aggregation === 'count'
        ? t('explorer.aggCount')
        : `${t(AGG_KEY[spec.aggregation])} · ${columnLabel(spec.y)}`
      : columnLabel(spec?.y ?? null);

  /* ---- The table twin ---- */
  const twin = useMemo(() => {
    if (!result?.ok || !spec || !dataset) return null;
    const table = tableTwin(result.shape);
    const xIsDate = columnFor(dataset.columns, spec.x)?.kind === 'date';
    const headers = table.headers.map((header, i) => {
      if (result.shape.type === 'scatter') {
        return header === 'series' ? t('explorer.roleGroup') : header === 'x' ? columnLabel(spec.x) : columnLabel(spec.y);
      }
      if (header === 'x') return columnLabel(spec.x);
      if (result.shape.type === 'box' && i > 0) return STAT_KEY[header] ? t(STAT_KEY[header]) : header;
      return seriesLabel(header);
    });
    const format = (value: unknown, column: number): string => {
      if (value === null || value === undefined) return '—';
      if (result.shape.type === 'scatter') {
        if (column === 0) return seriesLabel(String(value));
        if (column === 1 && xIsDate) return formatInstant(Number(value), locale);
      } else if (column === 0) {
        return categoryLabel(String(value));
      }
      return typeof value === 'number' ? formatExplorerNumber(value, locale) : String(value);
    };
    return { headers, rows: table.rows, numeric: table.headers.map((_, i) => i > 0), format };
    /* The label helpers close over spec, dataset, locale and t — all keyed. */
  }, [result, spec, dataset, locale, t]);

  const legendSeries =
    spec?.group && result?.ok && result.shape.type !== 'box' ? result.shape.series : [];

  const activeFilters = dataset ? filters.filter((filter) => isActive(filter, dataset.columns)).length : 0;
  const rowCount = dataset?.rowCount ?? 0;

  /* The collapsed panel's one-line summary, so a phone user can see what the
     chart is without opening the settings. */
  const summary = spec
    ? [
        t(CHART_KEY[spec.type]),
        [yLabel, columnLabel(spec.x)].filter(Boolean).join(' × '),
        activeFilters > 0 ? t('explorer.filterSummary', { count: activeFilters }) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : t(SOURCE_LABEL[source]);

  return (
    <div className="xp-page">
      <header className="xp-page-head">
        <button type="button" className="xp-back" onClick={() => onNavigate('analytics')}>
          <Icon icon={ArrowLeft} size="sm" />
          {t('explorer.backToAnalytics')}
        </button>
        <div className="xp-title-block">
          <span className="xp-mark" aria-hidden="true">
            <Icon icon={Database} />
          </span>
          <div>
            <h1 id="xp-title">{t('explorer.title')}</h1>
            <p>
              {t(SOURCE_LABEL[source])}
              {dataset && <> · {t('explorer.rowCount', { count: rowCount })}</>}
            </p>
          </div>
        </div>
      </header>

      <div className="xp-layout">
        <aside className={cx('xp-side', !settingsOpen && 'is-collapsed')} aria-label={t('explorer.settings')}>
          {/* Phones only. The controls take a full screen of height, which on a
              phone would push the chart — the thing being built — below the
              fold. Collapsed by default, with a summary of what is set. */}
          <button
            type="button"
            className="xp-settings-toggle"
            aria-expanded={settingsOpen}
            aria-controls="xp-side-body"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Icon icon={SlidersHorizontal} size="sm" />
            <span className="xp-settings-text">
              <strong>{t('explorer.settings')}</strong>
              <span>{summary}</span>
            </span>
            <Icon icon={ChevronDown} size="sm" className="xp-settings-chevron" />
          </button>

          <div className="xp-side-body" id="xp-side-body">
            <section className="xp-side-section" aria-labelledby="xp-chart-heading">
              <h2 id="xp-chart-heading">{t('explorer.chartSection')}</h2>
              <ExplorerControls
                source={source}
                onSource={(next) => {
                  setSource(next);
                  setView('chart');
                }}
                columns={dataset?.columns ?? []}
                spec={spec ?? defaultSpec('bar', [])}
                onSpec={(patch) => setSpec((previous) => (previous ? { ...previous, ...patch } : previous))}
                onChartType={(type) =>
                  dataset && setSpec((previous) => defaultSpec(type, dataset.columns, previous ?? undefined))
                }
                disabled={!dataset}
              />
            </section>

            <section className="xp-side-section" aria-labelledby="xp-filter-heading">
              <h2 id="xp-filter-heading">
                {t('explorer.filtersSection')}
                {activeFilters > 0 && <span className="xp-badge">{activeFilters}</span>}
              </h2>
              <ExplorerFilters
                dataset={dataset}
                filters={filters}
                onChange={setFilters}
                matched={filtered?.rowCount ?? null}
              />
            </section>
          </div>
        </aside>

        <section className="xp-main" aria-labelledby="xp-title">
          <div className="xp-tabs" role="tablist" aria-label={t('explorer.views')}>
            {(['chart', 'twin', 'raw'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                className={view === id ? 'is-active' : undefined}
                onClick={() => setView(id)}
              >
                {t(VIEW_KEY[id])}
              </button>
            ))}
          </div>

          {/* A refresh holds the previous render, dimmed — no skeleton flash. */}
          <div className={cx('xp-stage', query.isValidating && dataset && 'is-stale')} aria-live="polite">
            {query.error && !dataset ? (
              <div className="xp-message is-error">
                <Icon icon={AlertTriangle} />
                <p>{query.error}</p>
              </div>
            ) : !dataset || !filtered ? (
              <div className="xp-message">
                <span className="xp-loader" aria-hidden="true" />
                <p>{t('explorer.loading', { source: t(SOURCE_LABEL[source]) })}</p>
              </div>
            ) : rowCount === 0 ? (
              <div className="xp-message">
                <p>{t('explorer.emptySource')}</p>
              </div>
            ) : filtered.rowCount === 0 ? (
              <div className="xp-message">
                <p>{t('explorer.noMatches')}</p>
              </div>
            ) : view === 'raw' ? (
              /* Raw rows respect the filters too — this is the table the chart
                 is being drawn from, not the whole sheet. */
              <ExplorerTable
                headers={filtered.columns.map((c) => c.header)}
                rows={filtered.rows.map((row) => filtered.columns.map((c) => row[c.key]))}
                numeric={filtered.columns.map((c) => c.kind === 'number')}
                caption={t('explorer.viewRaw')}
                format={(value, column) => {
                  const kind = filtered.columns[column]?.kind;
                  if (value === null || value === undefined || value === '') return '—';
                  if (kind === 'number' && typeof value === 'number') return formatExplorerNumber(value, locale);
                  if (kind === 'boolean') return value ? t('explorer.yes') : t('explorer.no');
                  return String(value);
                }}
              />
            ) : !result ? null : !result.ok ? (
              <div className="xp-message">
                <p>{t(PROBLEM_KEY[result.problem])}</p>
              </div>
            ) : view === 'twin' && twin ? (
              <ExplorerTable
                headers={twin.headers}
                rows={twin.rows}
                numeric={twin.numeric}
                format={twin.format}
                caption={t('explorer.viewTwin')}
              />
            ) : (
              <>
                {legendSeries.length > 0 && (
                  <ExplorerLegend
                    series={legendSeries}
                    colorOf={colorOf}
                    labelOf={seriesLabel}
                    customized={customized}
                    surface={surface}
                    onColor={setColor}
                    onReset={resetColor}
                    onResetAll={resetAllColors}
                  />
                )}
                <ExplorerChart
                  shape={result.shape}
                  spec={spec as ChartSpec}
                  colorOf={colorOf}
                  locale={locale}
                  xLabel={columnLabel(spec?.x ?? null)}
                  yLabel={yLabel}
                  categoryLabel={categoryLabel}
                  seriesLabel={seriesLabel}
                />
                <Notes shape={result.shape} />
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * What the chart did not draw, said out loud — sampling, folding and dropped
 * rows are decisions made on the reader's behalf, and a chart that makes them
 * silently misreports the table without saying so.
 */
function Notes({ shape }: { shape: import('../lib/explorerData').Shape }) {
  const { t } = useTranslation();
  const notes: string[] = [];

  if (shape.type === 'scatter' && shape.sampled) {
    notes.push(t('explorer.noteSampled', { shown: shape.shown, total: shape.total }));
  }
  if ('folded' in shape && shape.folded > 0) notes.push(t('explorer.noteFolded', { count: shape.folded }));
  if (shape.dropped > 0) notes.push(t('explorer.noteDropped', { count: shape.dropped }));
  if (shape.type === 'box') {
    const hidden = shape.boxes.reduce((sum, b) => sum + b.hiddenOutliers, 0);
    if (hidden > 0) notes.push(t('explorer.noteHiddenOutliers', { count: hidden }));
  }

  if (notes.length === 0) return null;
  return (
    <ul className="xp-notes">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}
