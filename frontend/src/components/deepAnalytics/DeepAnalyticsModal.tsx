import { AlertTriangle, Database, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/* This stylesheet is imported here, not from app.css, so Vite emits it as part
   of this lazily loaded chunk. The main app never downloads it — which is the
   whole of the "zero impact" constraint applied to CSS as well as to JS. */
import './deepAnalytics.css';

import { Icon } from '../Icon';
import { useExcelQuery } from '../../hooks/useExcelDB';
import {
  BLANK,
  ChartSpec,
  ChartType,
  OTHER,
  RawDataset,
  RawSource,
  columnFor,
  defaultSpec,
  shapeData,
  tableTwin,
} from '../../lib/explorerData';
import { formatBucket, formatExplorerNumber, formatInstant } from '../../lib/explorerFormat';
import { isDarkSurface } from '../../lib/explorerPalette';
import { cx } from '../../lib/format';
import { useSettings } from '../../state/SettingsContext';
import { ExplorerChart } from './ExplorerChart';
import { ExplorerControls, SOURCE_LABEL } from './ExplorerControls';
import { ExplorerTable } from './ExplorerTable';
import { TranslationKey } from '../../locales';
import { Aggregation, SpecProblem } from '../../lib/explorerData';

/* Typed maps rather than template-literal keys: `explorer.agg${x}` is a
   `string` to the compiler, which defeats the whole point of typed keys — a
   typo would build clean and render the raw key. */
const AGG_KEY: Record<Aggregation, TranslationKey> = {
  sum: 'explorer.aggSum',
  mean: 'explorer.aggMean',
  median: 'explorer.aggMedian',
  count: 'explorer.aggCount',
};
const VIEW_KEY: Record<'chart' | 'twin' | 'raw', TranslationKey> = {
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
const STAT_KEY: Record<string, TranslationKey> = {
  n: 'explorer.statN',
  min: 'explorer.statMin',
  q1: 'explorer.statQ1',
  median: 'explorer.statMedian',
  q3: 'explorer.statQ3',
  max: 'explorer.statMax',
};

/**
 * Deep Analytics — a JMP-style explorer over the raw sheets.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS STAYS OUT OF THE MAIN APP
 * ---------------------------------------------------------------------------
 * Three gates, each sufficient on its own for the thing it guards:
 *
 *   1. Code. This file is the default export of a module only ever reached
 *      through `lazy(() => import(...))` in AnalyticsPage, and AnalyticsPage
 *      only renders it once the button has been pressed. Until then the
 *      browser has not downloaded a byte of it — nor of its stylesheet, its
 *      chart renderer or its data layer, all of which are imported from here.
 *   2. Data. The query below carries an explicit `enabled` flag. It is also
 *      unreachable before the module loads, but the flag makes the intent
 *      legible where the fetch is declared rather than leaving it implied by
 *      where the component happens to be mounted.
 *   3. Payload. One source per request. Opening the explorer fetches the one
 *      table on screen, not all nine.
 *
 * ---------------------------------------------------------------------------
 * WHY A FULL-SCREEN DIALOG AND NOT /analytics/deep
 * ---------------------------------------------------------------------------
 * The router is a flat hash router over a `Route` union with no nesting; a
 * sub-route would mean teaching it paths, and every `Record<Route, …>` in the
 * shell — prefetch, refresh, labels — would need an entry for a screen that is
 * really a mode of another screen. A dialog sits over Analytics, keeps its
 * month context, and closes back to exactly where you were.
 */
export default function DeepAnalyticsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const locale = settings.locale;

  const [source, setSource] = useState<RawSource>('transactions');
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [view, setView] = useState<'chart' | 'twin' | 'raw'>('chart');

  const query = useExcelQuery<RawDataset>(
    '/api/analytics/raw-data',
    { source },
    /* Explicit, per the architecture above. Mounted means opened. */
    { enabled: true },
  );
  const dataset = query.data && query.data.source === source ? query.data : null;

  /* A new table means new columns: rebuild the spec against them, keeping
     whatever the previous one chose that the new table also has. */
  useEffect(() => {
    if (!dataset) return;
    setSpec((previous) => defaultSpec(previous?.type ?? 'bar', dataset.columns, previous ?? undefined));
  }, [dataset]);

  /* Which palette set to use, from the surface actually painted. Read rather
     than inferred from the theme name so the `custom` theme — whose surface is
     whatever the user chose — gets the right set too. */
  const dark = useMemo(() => {
    if (typeof window === 'undefined') return true;
    return isDarkSurface(getComputedStyle(document.documentElement).getPropertyValue('--surface'));
  }, [settings.theme, settings.customVars]);

  const result = useMemo(
    () => (dataset && spec ? shapeData(dataset, spec) : null),
    [dataset, spec],
  );

  /* ---- Dialog behaviour: focus in, focus back, Escape, no scroll behind ---- */
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [onClose]);

  /* ---- Labels ---- */
  const columnLabel = (key: string | null) =>
    (dataset && columnFor(dataset.columns, key)?.header) ?? '';

  const categoryLabel = (key: string): string => {
    if (key === BLANK) return t('explorer.blank');
    if (key === OTHER) return t('explorer.other');
    if (key === 'true') return t('explorer.yes');
    if (key === 'false') return t('explorer.no');
    if (spec && dataset && columnFor(dataset.columns, spec.x)?.kind === 'date' && /^\d{4}(-\d{2}){0,2}$/.test(key)) {
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

  /* ---- The table twin, formatted the way the chart shows it ---- */
  const twin = useMemo(() => {
    if (!result?.ok || !spec || !dataset) return null;
    const table = tableTwin(result.shape);
    const xIsDate = columnFor(dataset.columns, spec.x)?.kind === 'date';
    const headers = table.headers.map((header, i) => {
      if (header === 'x') return columnLabel(spec.x);
      if (result.shape.type === 'box' && i > 0) return STAT_KEY[header] ? t(STAT_KEY[header]) : header;
      if (result.shape.type === 'scatter') {
        return header === 'series' ? t('explorer.roleGroup') : header === 'x' ? columnLabel(spec.x) : columnLabel(spec.y);
      }
      return seriesLabel(header);
    });
    /* Every column after the first carries a number, in every form. */
    const numeric = table.headers.map((_, i) => i > 0);
    const format = (value: unknown, column: number): string => {
      if (value === null || value === undefined) return '—';
      if (column === 0 && result.shape.type !== 'scatter') return categoryLabel(String(value));
      if (result.shape.type === 'scatter' && column === 0) return seriesLabel(String(value));
      if (result.shape.type === 'scatter' && column === 1 && xIsDate) return formatInstant(Number(value), locale);
      return typeof value === 'number' ? formatExplorerNumber(value, locale) : String(value);
    };
    return { headers, rows: table.rows, numeric, format };
    /* The label helpers close over spec, dataset, locale and t — all keyed. */
  }, [result, spec, dataset, locale, t]);

  function changeType(type: ChartType) {
    if (!dataset) return;
    setSpec((previous) => defaultSpec(type, dataset.columns, previous ?? undefined));
  }

  const rowCount = dataset?.rowCount ?? 0;

  return (
    <div className="xp-backdrop" role="presentation">
      <div className="xp-dialog" role="dialog" aria-modal="true" aria-labelledby="xp-title">
        <header className="xp-header">
          <div className="xp-title-block">
            <span className="xp-mark" aria-hidden="true">
              <Icon icon={Database} />
            </span>
            <div>
              <h2 id="xp-title">{t('explorer.title')}</h2>
              <p>
                {t(SOURCE_LABEL[source])}
                {dataset && <> · {t('explorer.rowCount', { count: rowCount })}</>}
              </p>
            </div>
          </div>
          <div className="xp-header-actions">
            <button
              type="button"
              className="xp-icon-button"
              onClick={() => void query.refresh()}
              disabled={query.isValidating}
              aria-label={t('explorer.refresh')}
              title={t('explorer.refresh')}
            >
              <Icon icon={RefreshCw} size="sm" className={query.isValidating ? 'xp-spin' : undefined} />
            </button>
            <button
              ref={closeRef}
              type="button"
              className="xp-icon-button"
              onClick={onClose}
              aria-label={t('explorer.close')}
              title={t('explorer.close')}
            >
              <Icon icon={X} />
            </button>
          </div>
        </header>

        <div className="xp-body">
          <aside className="xp-side">
            <ExplorerControls
              source={source}
              onSource={(next) => {
                setSource(next);
                setView('chart');
              }}
              columns={dataset?.columns ?? []}
              spec={spec ?? defaultSpec('bar', [])}
              onSpec={(patch) => setSpec((previous) => (previous ? { ...previous, ...patch } : previous))}
              onChartType={changeType}
              disabled={!dataset}
            />
          </aside>

          <section className="xp-main" aria-live="polite">
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

            {/* A refresh holds the previous render at reduced opacity rather
                than flashing a skeleton — the layout does not jump. */}
            <div className={cx('xp-stage', query.isValidating && dataset && 'is-stale')}>
              {query.error && !dataset ? (
                <div className="xp-message is-error">
                  <Icon icon={AlertTriangle} />
                  <p>{query.error}</p>
                </div>
              ) : !dataset ? (
                <div className="xp-message">
                  <span className="xp-loader" aria-hidden="true" />
                  <p>{t('explorer.loading', { source: t(SOURCE_LABEL[source]) })}</p>
                </div>
              ) : rowCount === 0 ? (
                <div className="xp-message">
                  <p>{t('explorer.emptySource')}</p>
                </div>
              ) : view === 'raw' ? (
                <ExplorerTable
                  headers={dataset.columns.map((c) => c.header)}
                  rows={dataset.rows.map((row) => dataset.columns.map((c) => row[c.key]))}
                  numeric={dataset.columns.map((c) => c.kind === 'number')}
                  caption={t('explorer.viewRaw')}
                  format={(value, column) => {
                    const kind = dataset.columns[column]?.kind;
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
                  <ExplorerChart
                    shape={result.shape}
                    spec={spec as ChartSpec}
                    dark={dark}
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
    </div>
  );
}

/**
 * What the chart did not draw, said out loud.
 *
 * Every one of these is a decision the data layer made on the reader's behalf —
 * sampling, folding, dropping unusable rows — and a chart that makes them
 * silently is one that misreports the table without saying so.
 */
function Notes({ shape }: { shape: import('../../lib/explorerData').Shape }) {
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
