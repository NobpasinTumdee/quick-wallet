import { useCallback, useLayoutEffect, useMemo, useState } from 'react';

import { type GridCardDef, type GridLayout, defaultGridLayout, isDefaultGridLayout } from './gridModel';
import { type CardDef, type CardLayout, type ColumnSpan, effectiveSpan } from './layoutModel';
import { gridLayoutFormat } from './layoutFormats';
import {
  readSyncedLayout,
  useSyncedLayout,
  writeSyncedLayout,
} from './useSyncedLayout';

export { gridLayoutFormat, layoutStorageKey } from './layoutFormats';

/** This device's layout: see `gridLayoutFormat`. The default when nothing is stored. */
export function readLocalLayout<Id extends string>(
  page: string,
  legacyPage: string | undefined,
  userId: string | undefined,
  registry: readonly GridCardDef<Id>[],
): GridLayout<Id> {
  return readSyncedLayout(gridLayoutFormat(page, legacyPage, registry), userId);
}

/** Writes this device's copy (the current format's key only). */
export function writeLocalLayout<Id extends string>(page: string, userId: string | undefined, layout: GridLayout<Id>): void {
  writeSyncedLayout(gridLayoutFormat(page, page, []), userId, layout);
}

/**
 * The page's grid layout, read before the first paint and synced quietly
 * (useSyncedLayout.ts): this device's copy, the server's in the current
 * format and the server's from the first version — the newest wins, and only
 * the current format is ever uploaded.
 */
export function useCardLayout<Id extends string>(
  page: string,
  legacyPage: string | undefined,
  userId: string | undefined,
  registry: readonly GridCardDef<Id>[],
  /** Talk to the server at all. Off where the layout does not apply (below
   *  the sidebar breakpoint), so phones and tablets never ask about it. */
  syncEnabled = true,
) {
  const format = useMemo(() => gridLayoutFormat(page, legacyPage, registry), [page, legacyPage, registry]);
  const { layout, save } = useSyncedLayout(format, userId, syncEnabled);

  /** Back to the default. Saved as a marker rather than deleted — here and on
   *  the server — so this newer "reset" wins over an older custom copy on
   *  another device, which then lets go of it too. */
  const reset = useCallback(() => save({ ...defaultGridLayout(registry), reset: true }), [save, registry]);

  const isCustom = useMemo(() => !isDefaultGridLayout(layout, registry), [layout, registry]);

  return { layout, save, reset, isCustom };
}

/**
 * The grid's content width and column gap, kept current. Takes the element
 * itself (from a callback ref), because the grid mounts only once the page
 * has data. Measured in a layout effect, so the first paint already uses it.
 */
export function useGridMetrics(element: HTMLElement | null, active: boolean): { width: number; gap: number } {
  const [metrics, setMetrics] = useState({ width: 0, gap: 0 });

  useLayoutEffect(() => {
    if (!active || !element) return undefined;
    const measure = () => {
      const style = getComputedStyle(element);
      const width = element.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
      const gap = parseFloat(style.columnGap || '0') || 0;
      setMetrics((current) => (current.width === width && current.gap === gap ? current : { width, gap }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, active]);

  return metrics;
}

/** Each card's drawn width for this grid. */
export function useEffectiveSpans<Id extends string>(
  layout: CardLayout<Id>,
  registry: readonly CardDef<Id>[],
  metrics: { width: number; gap: number },
): Record<string, ColumnSpan> {
  return useMemo(() => {
    const spans: Record<string, ColumnSpan> = {};
    for (const card of layout.cards) {
      const def = registry.find((item) => item.id === card.id);
      spans[card.id] = def ? effectiveSpan(def, card.w, metrics.width, metrics.gap) : card.w;
    }
    return spans;
  }, [layout, registry, metrics.width, metrics.gap]);
}
