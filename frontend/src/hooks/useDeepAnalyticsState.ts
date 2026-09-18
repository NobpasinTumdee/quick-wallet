import { useCallback, useEffect, useMemo, useState } from 'react';

import { useExcelQuery } from './useExcelDB';
import {
  ChartSpec,
  ChartType,
  OTHER,
  RawDataset,
  RawSource,
  Series,
  SeriesMode,
  defaultSpec,
  seriesMode,
} from '../lib/explorerData';
import { Filter, applyFilters } from '../lib/explorerFilters';
import { OTHER_DARK, OTHER_LIGHT, isDarkSurface, seriesColor } from '../lib/explorerPalette';
import { useSettings } from '../state/SettingsContext';

/**
 * Everything Deep Analytics remembers, in one place.
 *
 * The page used to hold this inline. It moved out when the spec grew from
 * three single slots to lists and panels: the state and its invariants (a spec
 * rebuilt when the table changes, filters kept per source, colours scoped to
 * what the colour channel currently means) are easier to keep right when they
 * are not interleaved with two hundred lines of JSX.
 *
 * Drawing math lives in `useChartMath`; this hook never computes a shape.
 */

export type View = 'chart' | 'twin' | 'raw';

/* ------------------------------------------------------------------ */
/* Colour choices, remembered per device                               */
/* ------------------------------------------------------------------ */

/**
 * `{ "transactions:type": { "expense": "#c0392b" }, "transactions:@metrics": { "amount": … } }`
 *
 * Scoped by source and by what colour *means*. With an overlay the keys are
 * that column's values; with several Y variables they are column keys, under
 * the reserved `@metrics` scope (no column key starts with `@`). "expense"
 * coloured red under Type says nothing about a value that happens to share the
 * name elsewhere, and the colour must not follow it there.
 *
 * localStorage rather than the workbook: a chart colour is a view preference
 * of one screen on one device. Every access is guarded — blocked storage just
 * means the choice lasts for the session.
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

/** The storage scope for the current colour channel, or null when nothing is recolourable. */
export function colorScope(source: RawSource, spec: ChartSpec | null, mode: SeriesMode): string | null {
  if (!spec || mode === 'single') return null;
  return mode === 'metric' ? `${source}:@metrics` : `${source}:${spec.overlay}`;
}

export function useDeepAnalyticsState() {
  const { settings } = useSettings();

  const [source, setSourceState] = useState<RawSource>('transactions');
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [view, setView] = useState<View>('chart');
  /* Per source, so switching to Debts and back restores the Transactions
     filters rather than discarding them or applying them to the wrong table. */
  const [filtersBySource, setFiltersBySource] = useState<Partial<Record<RawSource, Filter[]>>>({});
  const [colors, setColors] = useState<ColorMap>(readColors);
  /* Mobile only — the panel is always open beside the chart on a desktop. */
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => writeColors(colors), [colors]);

  /* On-demand by construction: this hook's page does not exist until the route
     is visited, and `enabled` states the intent where the fetch is declared. */
  const query = useExcelQuery<RawDataset>('/api/analytics/raw-data', { source }, { enabled: true });
  const dataset = query.data && query.data.source === source ? query.data : null;

  const filters = filtersBySource[source] ?? [];
  const setFilters = useCallback(
    (next: Filter[]) => setFiltersBySource((previous) => ({ ...previous, [source]: next })),
    [source],
  );

  const setSource = useCallback((next: RawSource) => {
    setSourceState(next);
    setView('chart');
  }, []);

  /* A new table means new columns: rebuild the spec against them, keeping
     whatever the previous one chose that the new table also has. */
  useEffect(() => {
    if (!dataset) return;
    setSpec((previous) => defaultSpec(previous?.type ?? 'bar', dataset.columns, previous ?? undefined));
  }, [dataset]);

  const patchSpec = useCallback(
    (patch: Partial<ChartSpec>) => setSpec((previous) => (previous ? { ...previous, ...patch } : previous)),
    [],
  );

  const setChartType = useCallback(
    (type: ChartType) => {
      if (!dataset) return;
      setSpec((previous) => defaultSpec(type, dataset.columns, previous ?? undefined));
    },
    [dataset],
  );

  /* Filters run on raw rows, before anything is summarised. `applyFilters`
     returns the same object when nothing is active, so memos downstream hold. */
  const filtered = useMemo(() => (dataset ? applyFilters(dataset, filters) : null), [dataset, filters]);

  /* ---- Colour ---- */

  /* The painted surface — for the palette set and the contrast warning. Read
     rather than inferred from the theme name so `custom` works too. The
     settings are the dependencies because they are what repaint it. */
  const surface = useMemo(() => {
    if (typeof window === 'undefined') return '#111725';
    return getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#111725';
  },[settings.theme, settings.customVars]);
  const dark = isDarkSurface(surface);

  const mode: SeriesMode = spec ? seriesMode(spec) : 'single';
  const scope = colorScope(source, spec, mode);
  const scopeColors = useMemo(() => (scope ? colors[scope] ?? {} : {}), [colors, scope]);
  const customized = useMemo<ReadonlySet<string>>(() => new Set(Object.keys(scopeColors)), [scopeColors]);

  const colorOf = useCallback(
    (series: Series): string => {
      if (series.key === OTHER) return dark ? OTHER_DARK : OTHER_LIGHT;
      return scopeColors[series.key] ?? seriesColor(series.slot ?? 0, dark);
    },
    [scopeColors, dark],
  );

  const setColor = useCallback(
    (key: string, color: string) => {
      if (!scope) return;
      setColors((previous) => ({ ...previous, [scope]: { ...(previous[scope] ?? {}), [key]: color } }));
    },
    [scope],
  );
  const resetColor = useCallback(
    (key: string) => {
      if (!scope) return;
      setColors((previous) => {
        const { [key]: _removed, ...rest } = previous[scope] ?? {};
        return { ...previous, [scope]: rest };
      });
    },
    [scope],
  );
  const resetAllColors = useCallback(() => {
    if (!scope) return;
    setColors((previous) => {
      const { [scope]: _removed, ...rest } = previous;
      return rest;
    });
  }, [scope]);

  return {
    source,
    setSource,
    query,
    dataset,
    spec,
    patchSpec,
    setChartType,
    mode,
    view,
    setView,
    filters,
    setFilters,
    filtered,
    settingsOpen,
    setSettingsOpen,
    surface,
    dark,
    colorOf,
    customized,
    setColor,
    resetColor,
    resetAllColors,
  };
}

export type DeepAnalyticsState = ReturnType<typeof useDeepAnalyticsState>;
