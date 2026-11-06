import { Check, ChevronsDownUp, ChevronsUpDown, EyeOff, GripVertical, Maximize2, Plus, RotateCcw } from 'lucide-react';
import {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '../lib/format';
import {
  CardDef,
  CardLayout,
  ColumnSpan,
  GRID_COLUMNS,
  HeightStep,
  gapSuggestion,
  moveCardBy,
  moveCardTo,
  packRows,
  updateCard,
} from '../lib/layout/layoutModel';
import { overlayCount } from '../lib/overlayStack';
import type { TranslationKey } from '../locales/en';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { Button, Portal, Select } from './ui';

/**
 * Edit mode for a card layout (desktop Home today).
 *
 * Loaded on demand: none of this is in the page's own chunk, because almost
 * every visit to Home never customises it.
 *
 * It works on a draft the page owns. Nothing here saves: Done hands the draft
 * back, Cancel drops it, Reset asks first and then goes back to the default.
 *
 * Each card is drawn inside a frame with its controls; the card itself is
 * `inert` — visible exactly as it will be, but nothing in it can be clicked
 * or focused, so a drag never opens a budget by accident.
 *
 * Moving a card:
 *  - pointer: drag the handle; the card stays in the grid as a dashed
 *    placeholder at its new spot while a small label follows the pointer;
 *  - keyboard: focus the handle and press the arrow keys (earlier / later);
 *  - both are announced to screen readers.
 */

export interface EditorCardDef extends CardDef {
  titleKey: TranslationKey;
}

const SIZE_KEYS: Record<ColumnSpan, TranslationKey> = {
  3: 'layout.sizeSmall',
  4: 'layout.sizeMedium',
  6: 'layout.sizeLarge',
  8: 'layout.sizeWide',
  12: 'layout.sizeFull',
};

const HEIGHT_KEYS: Record<HeightStep, TranslationKey> = {
  normal: 'layout.heightNormal',
  tall: 'layout.heightTall',
};

/** Distance from the window edge where a drag scrolls the page. */
const SCROLL_EDGE = 72;

export interface CardLayoutEditorProps {
  registry: readonly EditorCardDef[];
  draft: CardLayout;
  onChange: (next: CardLayout) => void;
  /** Each card's drawn width for the draft on this screen. */
  spans: Readonly<Record<string, ColumnSpan>>;
  renderCard: (id: string, tall: boolean) => ReactNode;
  gridRef: (element: HTMLDivElement | null) => void;
  gridClassName: string;
  onDone: () => void;
  onCancel: () => void;
  onReset: () => void;
}

interface DragState {
  id: string;
  pointerId: number;
  origin: CardLayout;
  /** Removes the window listeners that follow this drag. */
  stop: () => void;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function CardLayoutEditor({
  registry,
  draft,
  onChange,
  spans,
  renderCard,
  gridRef,
  gridClassName,
  onDone,
  onCancel,
  onReset,
}: CardLayoutEditorProps) {
  const { t } = useTranslation();
  const helpId = useId();
  const titleId = useId();

  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState('');
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  const [barTop, setBarTop] = useState(0);

  const grid = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const latest = useRef(draft);
  latest.current = draft;
  /** A control to focus after the next render (a moved, hidden or shown card). */
  const focusNext = useRef<string | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());

  const defOf = useCallback((id: string) => registry.find((def) => def.id === id), [registry]);
  const titleOf = useCallback((id: string) => {
    const def = registry.find((item) => item.id === id);
    return def ? t(def.titleKey) : id;
  }, [registry, t]);
  const sizeName = (w: ColumnSpan) => t(SIZE_KEYS[w]);

  /* Polite announcements; a zero-width space alternates so the same sentence
     twice in a row is still read out. */
  const flip = useRef(false);
  const announce = useCallback((text: string) => {
    flip.current = !flip.current;
    setMessage(flip.current ? text : `${text}​`);
  }, []);

  const setGrid = useCallback(
    (element: HTMLDivElement | null) => {
      grid.current = element;
      gridRef(element);
    },
    [gridRef],
  );

  /* ---- Entering: focus the bar's heading, so the next Tab starts at the
     controls rather than somewhere behind them. ---- */
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const bar = heading.current?.closest<HTMLElement>('.layout-editbar');
    if (bar && bar.getBoundingClientRect().top > window.innerHeight - 80) bar.scrollIntoView({ block: 'center' });
    announce(t('layout.announceStart'));
  }, [announce, t]);

  /* ---- The bar sits under the sticky top bar, whatever its height. ---- */
  useLayoutEffect(() => {
    const topbar = document.querySelector<HTMLElement>('.topbar');
    if (!topbar) return undefined;
    const apply = () => setBarTop(Math.round(topbar.getBoundingClientRect().height));
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(apply);
    observer.observe(topbar);
    return () => observer.disconnect();
  }, []);

  /* ---- Smooth movement: every card that changed place slides from where it
     was (offsets ignore transforms, so a running slide never skews this). ---- */
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const animate = !reducedMotion();
    const next = new Map<string, { x: number; y: number }>();
    element.querySelectorAll<HTMLElement>('[data-card-id]').forEach((card) => {
      const id = card.dataset.cardId ?? '';
      const now = { x: card.offsetLeft, y: card.offsetTop };
      next.set(id, now);
      const before = positions.current.get(id);
      if (animate && before && (before.x !== now.x || before.y !== now.y) && typeof card.animate === 'function') {
        card.animate(
          [{ transform: `translate(${before.x - now.x}px, ${before.y - now.y}px)` }, { transform: 'none' }],
          { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        );
      }
    });
    positions.current = next;

    if (focusNext.current) {
      const target = document.querySelector<HTMLElement>(focusNext.current);
      focusNext.current = null;
      target?.focus();
    }
  });

  /* ---- Drag ---- */

  /** Where an element sits now, ignoring any slide in progress. */
  const restingRect = (element: HTMLElement) => {
    const origin = grid.current!.getBoundingClientRect();
    return {
      left: origin.left + element.offsetLeft,
      top: origin.top + element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    };
  };

  const placeAt = useCallback((x: number, y: number) => {
    const state = drag.current;
    const element = grid.current;
    if (!state || !element) return;
    const targets = element.querySelectorAll<HTMLElement>('[data-card-id], [data-after-id]');
    for (const target of Array.from(targets)) {
      const rect = restingRect(target);
      if (x < rect.left || x > rect.left + rect.width || y < rect.top || y > rect.top + rect.height) continue;
      const overId = target.dataset.cardId;
      const next = overId
        ? overId === state.id
          ? latest.current
          : moveCardTo(latest.current, state.id, overId, x > rect.left + rect.width / 2)
        : moveCardTo(latest.current, state.id, target.dataset.afterId ?? '', true);
      if (next !== latest.current) {
        latest.current = next;
        onChange(next);
      }
      return;
    }
  }, [onChange]);

  /* While dragging near the top or bottom of the window, scroll it. */
  const dragging = ghost?.id ?? null;
  useEffect(() => {
    if (!dragging) return undefined;
    let frame = 0;
    const tick = () => {
      const { x, y } = pointer.current;
      const top = barTop + SCROLL_EDGE;
      const step = y < top ? -Math.ceil((top - y) / 6) : y > window.innerHeight - SCROLL_EDGE ? Math.ceil((y - (window.innerHeight - SCROLL_EDGE)) / 6) : 0;
      if (step) {
        window.scrollBy(0, step);
        placeAt(x, y);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [dragging, barTop, placeAt]);

  const finishDrag = (revert: boolean) => {
    const state = drag.current;
    if (!state) return;
    state.stop();
    drag.current = null;
    setGhost(null);
    if (revert) {
      latest.current = state.origin;
      onChange(state.origin);
      return;
    }
    const visible = latest.current.cards.filter((card) => !card.hidden);
    const position = visible.findIndex((card) => card.id === state.id) + 1;
    announce(t('layout.announceMoved', { title: titleOf(state.id), position, total: visible.length }));
  };

  /* The pointer is followed on the window, not the handle: reordering moves
     the handle's element in the page, which would drop a pointer capture and
     with it the release that ends the drag. */
  const finishRef = useRef(finishDrag);
  finishRef.current = finishDrag;

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const pointerId = event.pointerId;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      pointer.current = { x: next.clientX, y: next.clientY };
      setGhost({ id, x: next.clientX, y: next.clientY });
      placeAt(next.clientX, next.clientY);
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId === pointerId) finishRef.current(false);
    };
    const cancel = (next: PointerEvent) => {
      if (next.pointerId === pointerId) finishRef.current(true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    drag.current = { id, pointerId, origin: latest.current, stop };
    pointer.current = { x: event.clientX, y: event.clientY };
    setGhost({ id, x: event.clientX, y: event.clientY });
  };

  /* Leaving edit mode mid-drag still lets go of the window. */
  useEffect(() => () => drag.current?.stop(), []);

  /* ---- Keyboard ---- */

  const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    if (!delta || drag.current) return;
    event.preventDefault();
    const next = moveCardBy(latest.current, id, delta);
    if (next === latest.current) return;
    latest.current = next;
    focusNext.current = `[data-handle-for="${id}"]`;
    onChange(next);
    const visible = next.cards.filter((card) => !card.hidden);
    announce(t('layout.announceMoved', { title: titleOf(id), position: visible.findIndex((card) => card.id === id) + 1, total: visible.length }));
  };

  /* Escape: ends a drag where it started; otherwise leaves edit mode without
     saving — unless a dialog is open, which gets the key instead. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || confirmReset || overlayCount() > 0) return;
      event.preventDefault();
      if (drag.current) finishDrag(true);
      else onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  /* ---- Card settings ---- */

  const change = (id: string, patch: Parameters<typeof updateCard>[3], spoken: string, focus?: string) => {
    const next = updateCard(latest.current, registry, id, patch);
    latest.current = next;
    if (focus) focusNext.current = focus;
    onChange(next);
    announce(spoken);
  };

  /* Inert marks the card's own content as display only. */
  const inert = useCallback((element: HTMLDivElement | null) => {
    if (element) element.setAttribute('inert', '');
  }, []);

  /* ---- What gets drawn ---- */

  const visible = draft.cards.filter((card) => !card.hidden);
  const hidden = draft.cards.filter((card) => card.hidden);
  const rows = packRows(visible.map((card) => ({ id: card.id, span: spans[card.id] ?? card.w })));

  const cardFrame = (id: string) => {
    const card = draft.cards.find((item) => item.id === id)!;
    const def = defOf(id);
    if (!def) return null;
    const title = titleOf(id);
    const span = spans[id] ?? card.w;
    return (
      <div
        key={id}
        data-card-id={id}
        className={cx('lcard', `lspan-${span}`, ghost?.id === id && 'is-dragging', card.collapsed && 'is-collapsed')}
        role="group"
        aria-label={title}
      >
        <div className="lcard-bar">
          <button
            type="button"
            className="lcard-handle"
            data-handle-for={id}
            aria-label={t('layout.moveCard', { title })}
            aria-describedby={helpId}
            onPointerDown={(event) => onHandlePointerDown(event, id)}
            onKeyDown={(event) => onHandleKeyDown(event, id)}
          >
            <Icon icon={GripVertical} size="sm" />
          </button>
          <span className="lcard-title truncate">{title}</span>
          <span className="lcard-tools">
            <button
              type="button"
              className="lcard-icon"
              aria-pressed={!!card.collapsed}
              aria-label={t(card.collapsed ? 'layout.expandCard' : 'layout.collapseCard', { title })}
              title={t(card.collapsed ? 'layout.expand' : 'layout.collapse')}
              onClick={() =>
                change(id, { collapsed: !card.collapsed }, t(card.collapsed ? 'layout.announceExpanded' : 'layout.announceCollapsed', { title }))
              }
            >
              <Icon icon={card.collapsed ? ChevronsUpDown : ChevronsDownUp} size="sm" />
            </button>
            <button
              type="button"
              className="lcard-icon"
              aria-label={t('layout.hideCard', { title })}
              title={t('layout.hide')}
              onClick={() => change(id, { hidden: true }, t('layout.announceHidden', { title }), `[data-show-for="${id}"]`)}
            >
              <Icon icon={EyeOff} size="sm" />
            </button>
          </span>
          <span className="lcard-selects">
            <Select
              className="lcard-select"
              aria-label={t('layout.widthOf', { title })}
              value={card.w}
              onChange={(event) => {
                const w = Number(event.target.value) as ColumnSpan;
                change(id, { w }, t('layout.announceWidth', { title, size: sizeName(w) }));
              }}
            >
              {def.widths.map((w) => (
                <option key={w} value={w}>
                  {sizeName(w)}
                </option>
              ))}
            </Select>
            {def.heights && (
              <Select
                className="lcard-select"
                aria-label={t('layout.heightOf', { title })}
                value={card.h ?? def.heights[0]}
                onChange={(event) => {
                  const h = event.target.value as HeightStep;
                  change(id, { h }, t('layout.announceHeight', { title, size: t(HEIGHT_KEYS[h]) }));
                }}
              >
                {def.heights.map((h) => (
                  <option key={h} value={h}>
                    {t(HEIGHT_KEYS[h])}
                  </option>
                ))}
              </Select>
            )}
          </span>
        </div>
        {span !== card.w && <p className="lcard-note">{t('layout.shownAs', { size: sizeName(span) })}</p>}
        {card.collapsed ? (
          <p className="lcard-note">{t('layout.collapsedNote')}</p>
        ) : (
          <div className="lcard-body" ref={inert}>
            {renderCard(id, card.h === 'tall')}
          </div>
        )}
      </div>
    );
  };

  const gapFiller = (row: (typeof rows)[number]) => {
    const gap = GRID_COLUMNS - row.used;
    if (gap <= 0) return null;
    const lastId = row.ids[row.ids.length - 1];
    const suggestion = gapSuggestion(row, registry, spans);
    const label = suggestion ? t('layout.fillGap', { title: titleOf(suggestion.id), size: sizeName(suggestion.w) }) : t('layout.gapHint');
    const roomy = gap >= 3;
    return (
      <div key={`gap-${lastId}`} className="lgap" data-after-id={lastId} style={{ gridColumn: `span ${gap}` }}>
        {roomy && <span className="lgap-label">{t('layout.gap')}</span>}
        {suggestion ? (
          <button
            type="button"
            className={cx('lgap-fill', !roomy && 'is-compact')}
            title={label}
            aria-label={label}
            onClick={() =>
              change(
                suggestion.id,
                { w: suggestion.w },
                t('layout.announceWidth', { title: titleOf(suggestion.id), size: sizeName(suggestion.w) }),
              )
            }
          >
            <Icon icon={Maximize2} size="sm" />
            {roomy && <span>{label}</span>}
          </button>
        ) : (
          roomy && <span className="lgap-hint">{label}</span>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="layout-editbar" style={{ top: barTop }} role="region" aria-labelledby={titleId}>
        <div className="layout-editbar-text">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="layout-editbar-title">
            {t('layout.editTitle')}
          </h2>
          <p id={helpId} className="layout-editbar-hint">
            {t('layout.editHint')}
          </p>
        </div>

        <div className="layout-editbar-tray" role="group" aria-label={t('layout.hiddenTray')}>
          <span className="section-label">{t('layout.hiddenTray')}</span>
          {hidden.length === 0 ? (
            <span className="layout-editbar-none">{t('layout.hiddenNone')}</span>
          ) : (
            hidden.map((card) => {
              const title = titleOf(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  className="layout-chip"
                  data-show-for={card.id}
                  aria-label={t('layout.showCard', { title })}
                  onClick={() =>
                    change(card.id, { hidden: false }, t('layout.announceShown', { title }), `[data-handle-for="${card.id}"]`)
                  }
                >
                  <Icon icon={Plus} size="sm" />
                  <span className="truncate">{title}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="layout-editbar-actions">
          <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
            <Icon icon={RotateCcw} size="sm" />
            {t('layout.reset')}
          </Button>
          <Button size="sm" onClick={onCancel}>
            {t('layout.cancel')}
          </Button>
          <Button size="sm" variant="primary" onClick={onDone}>
            <Icon icon={Check} size="sm" />
            {t('layout.done')}
          </Button>
        </div>
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {message}
      </div>

      <div ref={setGrid} className={cx(gridClassName, 'is-editing', ghost && 'is-drag-active')}>
        {rows.map((row) => [...row.ids.map(cardFrame), gapFiller(row)])}
      </div>

      {ghost && (
        <Portal>
          <div className="lcard-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
            <Icon icon={GripVertical} size="sm" />
            {titleOf(ghost.id)}
          </div>
        </Portal>
      )}

      <ConfirmDialog
        open={confirmReset}
        title={t('layout.resetTitle')}
        body={t('layout.resetBody')}
        confirmLabel={t('layout.resetConfirm')}
        cancelLabel={t('layout.cancel')}
        onConfirm={() => {
          setConfirmReset(false);
          onReset();
        }}
        onClose={() => setConfirmReset(false)}
      />
    </>
  );
}
