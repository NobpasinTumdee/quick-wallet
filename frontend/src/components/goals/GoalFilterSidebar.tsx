import { PanelLeftClose, SlidersHorizontal, X } from 'lucide-react';
import { KeyboardEvent, PointerEvent, ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../Icon';
import { Badge, Button } from '../ui';
import { cx } from '../../lib/format';

export const PANEL_MIN = 240;
export const PANEL_MAX = 420;
export const PANEL_DEFAULT = 300;
/** Arrow keys move the edge this far; with Shift, three times as far. */
const KEY_STEP = 16;

export function clampPanelWidth(width: number): number {
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(width)));
}

/**
 * The desktop filter panel, in one of three shapes.
 *
 * ---------------------------------------------------------------------------
 *   docked   wide screens, open: a column beside the list, resizable by
 *            its right edge (drag, arrow keys, double-click to reset).
 *   rail     wide screens, closed: a 52px strip with the Filters button and
 *            the active-filter count, so a closed panel still says when
 *            something is filtered. The list takes the width back.
 *   drawer   medium screens: the panel would squeeze the list into a
 *            column of half-width cards, so it slides over it instead and
 *            starts closed. No dark backdrop — the list stays readable
 *            behind it — but a click outside or Escape closes it.
 * ---------------------------------------------------------------------------
 *
 * Phones never get here; they keep the bottom sheet in GoalFilterBar.
 */
export function GoalFilterSidebar({
  mode,
  open,
  onOpenChange,
  width,
  onWidth,
  count,
  onClear,
  children,
}: {
  mode: 'docked' | 'drawer';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width: number;
  onWidth: (width: number) => void;
  /** Active filters, for the badge. */
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  /* Drawer: Escape and an outside click close it, like any popover. */
  useEffect(() => {
    if (mode !== 'drawer' || !open) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!panelRef.current || !target || panelRef.current.contains(target)) return;
      /* The toolbar button that opened it toggles it itself. */
      if ((target as Element).closest?.('[data-goal-filters-toggle]')) return;
      /* A modal opened from inside the drawer (none today) or a select's
         native popup should not count as outside. */
      if ((target as Element).closest?.('.modal-backdrop')) return;
      onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [mode, open, onOpenChange]);

  if (mode === 'docked' && !open) {
    return (
      <aside className="goals-rail" aria-label={t('goals.filtersTitle')}>
        <button
          type="button"
          className="goals-rail-open"
          onClick={() => onOpenChange(true)}
          aria-expanded={false}
          aria-label={t('goals.showFilters')}
          title={t('goals.showFilters')}
        >
          <Icon icon={SlidersHorizontal} size="sm" />
          {count > 0 && <span className="goals-rail-badge">{count}</span>}
        </button>
      </aside>
    );
  }

  if (mode === 'drawer' && !open) return null;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
    document.body.classList.add('is-resizing-goals');
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    onWidth(clampPanelWidth(drag.current.startWidth + event.clientX - drag.current.startX));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    document.body.classList.remove('is-resizing-goals');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onHandleKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? KEY_STEP * 3 : KEY_STEP;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = width - step;
    else if (event.key === 'ArrowRight') next = width + step;
    else if (event.key === 'Home') next = PANEL_MIN;
    else if (event.key === 'End') next = PANEL_MAX;
    else if (event.key === 'Enter') next = PANEL_DEFAULT;
    if (next === null) return;
    event.preventDefault();
    onWidth(clampPanelWidth(next));
  }

  return (
    <aside
      ref={panelRef}
      className={cx('goals-panel', mode === 'drawer' ? 'goals-panel--drawer' : 'goals-panel--docked')}
      aria-label={t('goals.filtersTitle')}
      style={mode === 'drawer' ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}
    >
      <div className="goals-panel-head">
        <h2>
          {t('goals.filters')}
          {count > 0 && <Badge tone="accent">{count}</Badge>}
        </h2>
        <div className="goals-panel-tools">
          {count > 0 && (
            <Button size="sm" variant="ghost" onClick={onClear}>
              {t('goals.clearAll')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            aria-label={t('goals.hideFilters')}
            title={t('goals.hideFilters')}
          >
            <Icon icon={mode === 'drawer' ? X : PanelLeftClose} size="sm" />
          </Button>
        </div>
      </div>

      <div className="goals-panel-body">{children}</div>

      {mode === 'docked' && (
        /* A separator with a value is how assistive tech announces a
           splitter: "Resize filters, 300 of 420". */
        <div
          className="goals-panel-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('goals.resizeFilters')}
          aria-valuemin={PANEL_MIN}
          aria-valuemax={PANEL_MAX}
          aria-valuenow={width}
          title={t('goals.resizeFiltersHint')}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => onWidth(PANEL_DEFAULT)}
          onKeyDown={onHandleKey}
        />
      )}
    </aside>
  );
}
