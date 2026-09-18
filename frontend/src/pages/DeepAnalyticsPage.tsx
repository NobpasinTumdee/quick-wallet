import { AlertTriangle, ArrowLeft, ChevronDown, Database, SlidersHorizontal } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/* Imported here, not from app.css, so Vite emits it with this lazily loaded
   page. The main app never downloads it. */
import '../components/deepAnalytics/deepAnalytics.css';

import { Icon } from '../components/Icon';
import { ExplorerControls, SOURCE_LABEL } from '../components/deepAnalytics/ExplorerControls';
import { ExplorerFilters } from '../components/deepAnalytics/ExplorerFilters';
import { ExplorerLegend } from '../components/deepAnalytics/ExplorerLegend';
import { ExplorerTable } from '../components/deepAnalytics/ExplorerTable';
import { FacetGrid, TooManyFacets } from '../components/deepAnalytics/FacetGrid';
import { useChartMath } from '../hooks/useChartMath';
import { View, useDeepAnalyticsState } from '../hooks/useDeepAnalyticsState';
import { ChartNotes, facetTwin } from '../lib/explorerChartMath';
import {
  Aggregation,
  BLANK,
  ChartType,
  OTHER,
  RawColumn,
  SpecProblem,
  columnFor,
  defaultSpec,
  splitNestKey,
} from '../lib/explorerData';
import { isActive } from '../lib/explorerFilters';
import { formatBucket, formatExplorerNumber, formatInstant } from '../lib/explorerFormat';
import { cx } from '../lib/format';
import { Route } from '../lib/router';
import { TranslationKey } from '../locales';
import { useSettings } from '../state/SettingsContext';

/**
 * Deep Analytics — the raw-data explorer, as a page of its own.
 *
 * ---------------------------------------------------------------------------
 * THE PIPELINE
 * ---------------------------------------------------------------------------
 *   raw rows ──filters──▶ filtered rows ──partition (Page By)──▶ panels
 *        │                      │                                 │
 *        │                      └──frame: bands, line positions,  │
 *        │                         series — over ALL panels ──────┤
 *        └── series ranking (colour identity) ────────────────────┤
 *                                           shapes ──▶ domains over ALL panels
 *
 * Filters run on raw rows, before anything is summarised: filtering sums would
 * answer a different question. The frame and the domains are taken across
 * every panel, so the panels share one coordinate system and can be compared
 * by position — see `explorerChartMath.ts`.
 *
 * State lives in `useDeepAnalyticsState`, drawing math in `useChartMath`; this
 * file is labels and layout.
 *
 * ---------------------------------------------------------------------------
 * STILL OUT OF THE MAIN BUNDLE
 * ---------------------------------------------------------------------------
 * This is the default export of a module AppShell reaches only through
 * `lazy()`, and only renders on this route. `bundlecheck.mjs` fails the build
 * if a static import ever pulls any of it back in.
 */

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
  tooManyX: 'explorer.problemTooManyX',
  needY: 'explorer.problemNeedY',
  badY: 'explorer.problemBadY',
  tooManyY: 'explorer.problemTooManyY',
  badOverlay: 'explorer.problemBadOverlay',
  badPage: 'explorer.problemBadPage',
  tooManyBuckets: 'explorer.problemTooManyBuckets',
  tooManyFacets: 'explorer.problemTooManyFacets',
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

/** Bucket keys as `discreteKey` writes them — `2026`, `2026-03`, `2026-03-14`. */
const BUCKET_KEY = /^\d{4}(-\d{2}){0,2}$/;

export default function DeepAnalyticsPage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { t } = useTranslation();
  const state = useDeepAnalyticsState();
  const { source, dataset, filtered, spec, mode, view, query } = state;
  const locale = useSettings().settings.locale;

  const build = useChartMath(dataset, filtered, spec, state.customized);

  /* ---- Labels ---- */
  const columns = dataset?.columns ?? [];
  const columnLabel = useCallback(
    (key: string | null) => columnFor(dataset?.columns ?? [], key)?.header ?? '',
    [dataset],
  );

  /** One discrete value of one column, as a reader would say it. */
  const levelLabel = useCallback(
    (key: string, column: RawColumn | null): string => {
      if (key === BLANK) return t('explorer.blank');
      if (key === OTHER) return t('explorer.other');
      if (column?.kind === 'boolean') {
        if (key === 'true') return t('explorer.yes');
        if (key === 'false') return t('explorer.no');
      }
      if (column?.kind === 'date' && spec && BUCKET_KEY.test(key)) return formatBucket(key, spec.dateBucket, locale);
      return key;
    },
    [t, spec, locale],
  );

  /* Stable identities: the chart memoises its axis labels on this function. */
  const bandLabel = useCallback(
    (key: string): string[] => {
      if (key === OTHER) return [t('explorer.other')];
      const xColumns = (spec?.xVars ?? []).map((x) => columnFor(dataset?.columns ?? [], x));
      return splitNestKey(key).map((part, i) => levelLabel(part, xColumns[i] ?? null));
    },
    [spec, dataset, levelLabel, t],
  );

  const facetLabel = useCallback(
    (key: string) => levelLabel(key, columnFor(dataset?.columns ?? [], spec?.pageBy ?? null)),
    [levelLabel, dataset, spec],
  );

  const metricNames = (spec?.yVars ?? []).map(columnLabel).filter(Boolean).join(', ');
  const countOnly = spec?.aggregation === 'count' && (spec.type === 'bar' || spec.type === 'line');
  const yLabel = !spec
    ? ''
    : spec.type === 'bar' || spec.type === 'line'
      ? countOnly
        ? t('explorer.aggCount')
        : `${t(AGG_KEY[spec.aggregation])} · ${metricNames}`
      : metricNames;
  const xLabel = (spec?.xVars ?? []).map(columnLabel).filter(Boolean).join(' › ');

  const seriesLabel = useCallback(
    (key: string): string => {
      if (key === OTHER) return t('explorer.other');
      if (mode === 'metric') return columnLabel(key);
      if (mode === 'overlay') return levelLabel(key, columnFor(dataset?.columns ?? [], spec?.overlay ?? null));
      return yLabel;
    },
    [t, mode, columnLabel, levelLabel, dataset, spec, yLabel],
  );

  /* ---- The table twin: every panel in one table, the panel as a column ---- */
  const twin = useMemo(() => {
    if (!build?.ok || !spec) return null;
    const table = facetTwin(build.facets);
    const scatter = build.facets[0]?.shape.type === 'scatter';
    const box = build.facets[0]?.shape.type === 'box';
    const xIsDate = scatter && build.frame.xKind === 'date';

    const headers = table.headers.map((header) => {
      if (header === 'page') return columnLabel(spec.pageBy);
      if (header === 'x') return xLabel;
      if (header === 'series') return t('explorer.seriesColumn');
      if (scatter && header === 'y') return yLabel;
      if (box) return STAT_KEY[header] ? t(STAT_KEY[header]) : header;
      return seriesLabel(header);
    });
    const numeric = table.headers.map((header) => !['page', 'series'].includes(header) && !(header === 'x' && !scatter));
    const format = (value: unknown, column: number): string => {
      if (value === null || value === undefined) return '—';
      const role = table.headers[column];
      if (role === 'page') return facetLabel(String(value));
      if (role === 'series') return seriesLabel(String(value));
      if (role === 'x') {
        if (scatter) return xIsDate ? formatInstant(Number(value), locale) : formatExplorerNumber(Number(value), locale);
        if (typeof value === 'number') return formatExplorerNumber(value, locale);
        return bandLabel(String(value)).join(' · ');
      }
      return typeof value === 'number' ? formatExplorerNumber(value, locale) : String(value);
    };
    return { headers, rows: table.rows, numeric, format };
  }, [build, spec, columnLabel, xLabel, yLabel, seriesLabel, facetLabel, bandLabel, locale, t]);

  const legendSeries = build?.ok && mode !== 'single' ? build.frame.series : [];

  const activeFilters = dataset ? state.filters.filter((filter) => isActive(filter, dataset.columns)).length : 0;
  const rowCount = dataset?.rowCount ?? 0;

  /* The collapsed panel's one-line summary, so a phone user can see what the
     chart is without opening the settings. */
  const summary = spec
    ? [
        t(CHART_KEY[spec.type]),
        [yLabel, xLabel].filter(Boolean).join(' × '),
        spec.pageBy ? `${t('explorer.rolePage')}: ${columnLabel(spec.pageBy)}` : '',
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
        <aside className={cx('xp-side', !state.settingsOpen && 'is-collapsed')} aria-label={t('explorer.settings')}>
          {/* Phones only. The controls take a full screen of height, which on a
              phone would push the chart — the thing being built — below the
              fold. Collapsed by default, with a summary of what is set. */}
          <button
            type="button"
            className="xp-settings-toggle"
            aria-expanded={state.settingsOpen}
            aria-controls="xp-side-body"
            onClick={() => state.setSettingsOpen((open) => !open)}
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
                onSource={state.setSource}
                columns={columns}
                spec={spec ?? defaultSpec('bar', [])}
                onSpec={state.patchSpec}
                onChartType={state.setChartType}
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
                filters={state.filters}
                onChange={state.setFilters}
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
                onClick={() => state.setView(id)}
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
            ) : !build || !spec ? null : !build.ok ? (
              build.problem === 'tooManyFacets' ? (
                <TooManyFacets count={build.facetCount ?? 0} column={columnLabel(spec.pageBy)} />
              ) : (
                <div className="xp-message">
                  <p>{t(PROBLEM_KEY[build.problem])}</p>
                </div>
              )
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
                {build.faceted && (
                  <p className="xp-facet-caption">
                    {t('explorer.facetCaption', { column: columnLabel(spec.pageBy), count: build.facets.length })}
                  </p>
                )}
                {legendSeries.length > 0 && (
                  <ExplorerLegend
                    series={legendSeries}
                    colorOf={state.colorOf}
                    labelOf={seriesLabel}
                    customized={state.customized}
                    surface={state.surface}
                    onColor={state.setColor}
                    onReset={state.resetColor}
                    onResetAll={state.resetAllColors}
                  />
                )}
                <FacetGrid
                  facets={build.facets}
                  faceted={build.faceted}
                  domains={build.domains}
                  facetLabel={facetLabel}
                  colorOf={state.colorOf}
                  locale={locale}
                  xLabel={xLabel}
                  yLabel={yLabel}
                  bandLabel={bandLabel}
                  seriesLabel={seriesLabel}
                />
                <Notes notes={build.notes} />
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
function Notes({ notes }: { notes: ChartNotes }) {
  const { t } = useTranslation();
  const lines: string[] = [];

  if (notes.sampled) lines.push(t('explorer.noteSampled', { shown: notes.sampled.shown, total: notes.sampled.total }));
  if (notes.foldedBands > 0) lines.push(t('explorer.noteFoldedBands', { count: notes.foldedBands }));
  if (notes.foldedGroups > 0) lines.push(t('explorer.noteFolded', { count: notes.foldedGroups }));
  if (notes.dropped > 0) lines.push(t('explorer.noteDropped', { count: notes.dropped }));
  if (notes.hiddenOutliers > 0) lines.push(t('explorer.noteHiddenOutliers', { count: notes.hiddenOutliers }));

  if (lines.length === 0) return null;
  return (
    <ul className="xp-notes">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
