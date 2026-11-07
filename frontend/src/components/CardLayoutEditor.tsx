import { Check, ChevronsDownUp, ChevronsUpDown, EyeOff, GripVertical, Info, MoreHorizontal, Plus, RotateCcw, X } from 'lucide-react';
import {
  CSSProperties,
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
  GridCard,
  GridCardDef,
  GridLayout,
  ROW_PX,
  gridArea,
  minColumnsFor,
  moveGridCard,
  readingOrder,
  resizeGridCard,
  rowsOf,
  samePlacement,
  setGridCardFlags,
  showGridCard,
  showSize,
} from '../lib/layout/gridModel';
import { GRID_COLUMNS } from '../lib/layout/layoutModel';
import { overlayCount } from '../lib/overlayStack';
import type { TranslationKey } from '../locales/en';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { Button, Portal, Select, useOverlay } from './ui';

/**
 * Edit mode for a card layout on a grid of cells (desktop Home today).
 *
 * Loaded on demand: none of this is in the page's own chunk, because almost
 * every visit to Home never customises it.
 *
 * It works on a placed draft the page owns — every card with x, y, w and h
 * in cells. Nothing here saves: Done hands the draft back, Cancel drops it,
 * Reset asks first and then goes back to the default. Every change goes
 * through the grid model, so cards never overlap and always float up
 * (compaction is always on).
 *
 * Each card is drawn at its exact size, as on Home, with a slim bar of
 * controls straddling its top edge (in the card's own padding, so it never
 * covers what is in the card); the card itself is `inert` — visible exactly
 * as it will be, but nothing in it can be clicked or focused.
 *
 * Moving and resizing:
 *  - pointer: drag a card by its bar to any cell; drag its right edge, bottom
 *    edge or corner to resize it; drag a card from the widget panel (the
 *    cards not on Home) into the grid. The grid's cells show faintly, a
 *    placeholder shows where it will land with its size, and the other cards
 *    slide out of the way;
 *  - the widget panel's tiles are buttons too: a click adds the card at the
 *    first free spot;
 *  - keyboard, on the handle: arrow keys move one cell (up and down swap
 *    with the card above or below), Shift + arrow keys resize one cell; the
 *    ⋯ menu sets a width or height directly;
 *  - every change is announced to screen readers.
 *
 * A pointer drag never re-renders a card while it moves. The target layout
 * is worked out from the layout the drag started on, and shown with
 * transforms written straight to the card frames, once a frame at most; React
 * only hears of it on release, as one change. The cards' content therefore
 * never re-lays itself out mid-drag — except the card being resized, and
 * only when its size in cells changes.
 */

export interface EditorCardDef extends GridCardDef {
  titleKey: TranslationKey;
}

/** Distance from the window edge where a drag scrolls the page. */
const SCROLL_EDGE = 72;
/** How far the pointer goes before a press on a card's bar becomes a drag. */
const DRAG_THRESHOLD = 4;

export interface CardLayoutEditorProps {
  registry: readonly EditorCardDef[];
  draft: GridLayout;
  onChange: (next: GridLayout) => void;
  /** The grid's content width and gap, as measured. */
  metrics: { width: number; gap: number };
  /** A card's content, filling whatever size it is given. */
  renderCard: (id: string) => ReactNode;
  gridRef: (element: HTMLDivElement | null) => void;
  gridClassName: string;
  onDone: () => void;
  onCancel: () => void;
  onReset: () => void;
  /** The texts that name the page (Home by default). */
  texts?: EditorTexts;
}

/** The editor's texts that say which page is being customised. */
export interface EditorTexts {
  editTitle: TranslationKey;
  resetTitle: TranslationKey;
  hiddenNone: TranslationKey;
  announceStart: TranslationKey;
}

export const HOME_EDITOR_TEXTS: EditorTexts = {
  editTitle: 'layout.editTitle',
  resetTitle: 'layout.resetTitle',
  hiddenNone: 'layout.hiddenNone',
  announceStart: 'layout.announceStart',
};

type Edge = 'e' | 's' | 'se';

type DragKind = 'move' | 'resize' | 'add';

/** A pointer drag in progress: moving a card, resizing it from `edge`, or adding one from the widget panel. */
interface Session {
  id: string;
  kind: DragKind;
  edge: Edge;
  pointerId: number;
  /** The layout when the drag started; every step is worked out from it. */
  origin: GridLayout;
  /** Where the drag would leave things now. */
  next: GridLayout;
  /** Where in the card it was picked up (move), so it does not jump to the pointer. */
  grab: { x: number; y: number };
  /** Where the pointer went down. */
  start: { x: number; y: number };
  /** Adding: the size it comes in at, and whether the pointer is over the grid. */
  size: { w: number; h: number };
  inside: boolean;
  /** Removes the window listeners that follow this drag. */
  stop: () => void;
}

/** The grid's cells in pixels, against the viewport. */
interface Geometry {
  left: number;
  top: number;
  colW: number;
  colPitch: number;
  rowPitch: number;
  gap: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Overlap of column ranges. */
function sharesColumns(a: GridCard, b: GridCard): boolean {
  const ax = a.x ?? 0;
  const bx = b.x ?? 0;
  return ax < bx + b.w && bx < ax + a.w;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Below 1280px some cards are drawn wider than set (gridModel `fitGridToWidth`); edit mode says so. */
const NARROW_QUERY = '(max-width: 1279px)';

function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(NARROW_QUERY);
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return narrow;
}

function measureGrid(element: HTMLElement): Geometry {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const gap = parseFloat(style.columnGap) || 0;
  const width = element.clientWidth - padLeft - padRight;
  const colW = (width - gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  return {
    left: rect.left + element.clientLeft + padLeft,
    top: rect.top + element.clientTop + (parseFloat(style.paddingTop) || 0),
    colW,
    colPitch: colW + gap,
    rowPitch: ROW_PX + (parseFloat(style.rowGap) || 0),
    gap,
  };
}

/** A card's cells as a box in the grid, in pixels. */
function cellBox(card: GridCard, g: Geometry): Box {
  const rows = rowsOf(card);
  return {
    left: (card.x ?? 0) * g.colPitch,
    top: (card.y ?? 0) * g.rowPitch,
    width: card.w * g.colW + (card.w - 1) * g.gap,
    height: rows * ROW_PX + (rows - 1) * (g.rowPitch - ROW_PX),
  };
}

/**
 * The ⋯ menu of one card: its exact width and height. A small popover on
 * the overlay stack, so Escape closes it rather than edit mode; it follows
 * the button, and closes when the page scrolls or anything else is pressed.
 */
function CardMenu({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  label: string;
  onClose: (refocus: boolean) => void;
  children: ReactNode;
}) {
  useOverlay(true, () => onClose(true), { lockScroll: false });
  const panel = useRef<HTMLDivElement | null>(null);
  /* Measured off-screen first (not hidden: a hidden select cannot take focus). */
  const [place, setPlace] = useState<CSSProperties>({ left: -9999, top: 0 });

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const margin = 8;
    const a = anchor.getBoundingClientRect();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const viewW = document.documentElement.clientWidth;
    const left = Math.round(clamp(a.right - width, margin, viewW - width - margin));
    const below = a.bottom + 6;
    const top = Math.round(below + height > window.innerHeight - margin ? Math.max(margin, a.top - 6 - height) : below);
    setPlace((current) => (current.left === left && current.top === top ? current : { left, top }));
  });
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('select:not([disabled]), button')?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const down = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.contains(target)) return;
      onClose(false);
    };
    const away = () => onClose(false);
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('scroll', away, { passive: true });
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('scroll', away);
      window.removeEventListener('resize', away);
    };
  }, [anchor, onClose]);

  return (
    <Portal>
      <div
        ref={panel}
        className="lcard-menu"
        role="dialog"
        aria-label={label}
        style={place}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            onClose(true);
          }
        }}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && !panel.current?.contains(next)) onClose(false);
        }}
      >
        {children}
      </div>
    </Portal>
  );
}

export default function CardLayoutEditor({
  registry,
  draft,
  onChange,
  metrics,
  renderCard,
  gridRef,
  gridClassName,
  onDone,
  onCancel,
  onReset,
  texts = HOME_EDITOR_TEXTS,
}: CardLayoutEditorProps) {
  const { t } = useTranslation();
  const helpId = useId();
  const titleId = useId();

  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState('');
  /** The card being dragged or resized; set once when a drag starts and once when it ends. */
  const [active, setActive] = useState<{ id: string; kind: DragKind } | null>(null);
  const narrow = useNarrowWindow();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [barTop, setBarTop] = useState(0);

  const grid = useRef<HTMLDivElement | null>(null);
  const placeholder = useRef<HTMLDivElement | null>(null);
  const placeholderSize = useRef<HTMLSpanElement | null>(null);
  /** Adding: the tile that follows the pointer. */
  const ghost = useRef<HTMLDivElement | null>(null);
  /** A drag from a widget tile can end in a click on it; that click must not add the card too. */
  const ignoreClicksUntil = useRef(0);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const session = useRef<Session | null>(null);
  const paintFrame = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });
  const latest = useRef(draft);
  latest.current = draft;
  /** A control to focus after the next render (a moved, hidden or shown card). */
  const focusNext = useRef<string | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());

  const defOf = useCallback((id: string) => registry.find((def) => def.id === id), [registry]);
  const titleOf = useCallback(
    (id: string) => {
      const def = registry.find((item) => item.id === id);
      return def ? t(def.titleKey) : id;
    },
    [registry, t],
  );

  /** Narrowest a card may be made here: its own minimum, or wider if the screen needs it. */
  const minWidth = (def: GridCardDef) =>
    Math.min(GRID_COLUMNS, Math.max(Math.min(def.minW, GRID_COLUMNS), minColumnsFor(def.minPx, metrics.width, metrics.gap)));
  const minWidthRef = useRef(minWidth);
  minWidthRef.current = minWidth;

  /* Polite announcements; a zero-width space alternates so the same sentence
     twice in a row is still read out. */
  const flip = useRef(false);
  const announce = useCallback((text: string) => {
    flip.current = !flip.current;
    setMessage(flip.current ? text : `${text}​`);
  }, []);

  const placedText = (layout: GridLayout, id: string) => {
    const card = layout.cards.find((item) => item.id === id);
    return t('layout.announcePlaced', { title: titleOf(id), column: (card?.x ?? 0) + 1, row: (card?.y ?? 0) + 1 });
  };
  const sizeText = (layout: GridLayout, id: string) => {
    const card = layout.cards.find((item) => item.id === id);
    return t('layout.announceSize', { title: titleOf(id), w: card?.w ?? 0, h: card?.h ?? 0 });
  };

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
    announce(t(texts.announceStart));
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
     was (offsets ignore transforms, so a running slide never skews this). A
     drag records where each card was last seen on release, so the dropped
     card glides from the pointer into its cell and the rest stay put. ---- */
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
      if (animate && before && (Math.abs(before.x - now.x) > 0.5 || Math.abs(before.y - now.y) > 0.5) && typeof card.animate === 'function') {
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

  const commit = (next: GridLayout, spoken?: string, focus?: string) => {
    if (samePlacement(next, latest.current)) return false;
    latest.current = next;
    if (focus) focusNext.current = focus;
    onChange(next);
    if (spoken) announce(spoken);
    return true;
  };

  /* ---- Pointer drags: worked out from the start layout, drawn with
     transforms, at most once a frame ---- */

  const paint = useCallback(() => {
    paintFrame.current = 0;
    const s = session.current;
    const element = grid.current;
    if (!s || !element) return;
    const g = measureGrid(element);
    if (!(g.colPitch > 0)) return;
    const p = pointer.current;
    const from = s.origin.cards.find((card) => card.id === s.id);
    const def = registry.find((item) => item.id === s.id);
    if (!from || !def) return;

    let next: GridLayout;
    if (s.kind === 'add') {
      /* Over the grid (not the edit bar on top of it), the card goes in where
         the pointer is; anywhere else, nowhere. */
      const rect = element.getBoundingClientRect();
      const bar = document.querySelector<HTMLElement>('.layout-editbar')?.getBoundingClientRect();
      const overBar = !!bar && p.x >= bar.left && p.x <= bar.right && p.y >= bar.top && p.y <= bar.bottom;
      s.inside = !overBar && p.x >= rect.left - g.colPitch / 2 && p.x <= rect.right + g.colPitch / 2 && p.y >= rect.top - g.rowPitch;
      if (s.inside) {
        const column = Math.round((p.x - s.grab.x - g.left) / g.colPitch);
        const row = Math.max(0, Math.round((p.y - s.grab.y - g.top) / g.rowPitch));
        next = showGridCard(s.origin, registry, s.id, { x: column, y: row }, s.size);
      } else {
        next = s.origin;
      }
      if (ghost.current) ghost.current.style.transform = `translate(${p.x}px, ${p.y}px)`;
    } else if (s.kind === 'move') {
      const column = Math.round((p.x - s.grab.x - g.left) / g.colPitch);
      const row = Math.max(0, Math.round((p.y - s.grab.y - g.top) / g.rowPitch));
      next = moveGridCard(s.origin, s.id, column, row);
    } else {
      const box = cellBox(from, g);
      const x = from.x ?? 0;
      let w = from.w;
      let h = from.h ?? def.defaultH;
      if (s.edge !== 's') {
        const width = box.width + (p.x - s.start.x);
        w = clamp(Math.round((width + g.gap) / g.colPitch), minWidthRef.current(def), GRID_COLUMNS - x);
      }
      if (s.edge !== 'e' && !from.collapsed) {
        const height = box.height + (p.y - s.start.y);
        h = clamp(Math.round((height + g.rowPitch - ROW_PX) / g.rowPitch), def.minH, def.maxH);
      }
      next = resizeGridCard(s.origin, registry, s.id, w, h);
    }
    s.next = next;

    const startById = new Map(s.origin.cards.map((card) => [card.id, card]));
    const nextById = new Map(next.cards.map((card) => [card.id, card]));
    element.querySelectorAll<HTMLElement>('[data-card-id]').forEach((frame) => {
      const id = frame.dataset.cardId ?? '';
      const a = startById.get(id);
      const b = nextById.get(id);
      if (!a || !b) return;
      const was = cellBox(a, g);
      if (s.kind === 'move' && id === s.id) {
        /* The card itself follows the pointer. */
        frame.style.transform = `translate(${p.x - s.grab.x - g.left - was.left}px, ${p.y - s.grab.y - g.top - was.top}px)`;
        return;
      }
      const now = cellBox(b, g);
      const dx = now.left - was.left;
      const dy = now.top - was.top;
      frame.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
      if (id === s.id) {
        /* The card being resized takes its new size in cells: its content
           re-fits only when that changes, never on every pointer move. */
        const size = `${now.width}x${now.height}`;
        if (frame.dataset.previewSize !== size) {
          frame.dataset.previewSize = size;
          frame.style.width = `${now.width}px`;
          frame.style.height = `${now.height}px`;
        }
      }
    });

    const target = nextById.get(s.id);
    const ph = placeholder.current;
    if (ph) ph.style.display = s.kind === 'add' && !s.inside ? 'none' : '';
    if (target && ph && !target.hidden) {
      const box = cellBox(target, g);
      ph.style.transform = `translate(${box.left}px, ${box.top}px)`;
      ph.style.width = `${box.width}px`;
      ph.style.height = `${box.height}px`;
      const label = `${target.w} × ${rowsOf(target)}`;
      if (placeholderSize.current && placeholderSize.current.textContent !== label) placeholderSize.current.textContent = label;
    }
  }, [registry]);

  const schedulePaint = useCallback(() => {
    if (!paintFrame.current) paintFrame.current = window.requestAnimationFrame(paint);
  }, [paint]);

  /* The first frame of a drag is drawn before it is shown. */
  useLayoutEffect(() => {
    if (active) paint();
  }, [active, paint]);

  /* While dragging near the top or bottom of the window, scroll it. */
  useEffect(() => {
    if (!active) return undefined;
    let frame = 0;
    const tick = () => {
      const { y } = pointer.current;
      /* Up near the bottom of the sticky bars, not over them: a drag that
         starts on a widget tile up there must not scroll the page away. */
      const edge = document.querySelector<HTMLElement>('.layout-editbar')?.getBoundingClientRect().bottom ?? barTop;
      const top = edge + SCROLL_EDGE;
      const step =
        y >= edge && y < top
          ? -Math.ceil((top - y) / 6)
          : y > window.innerHeight - SCROLL_EDGE
            ? Math.ceil((y - (window.innerHeight - SCROLL_EDGE)) / 6)
            : 0;
      if (step) {
        window.scrollBy(0, step);
        schedulePaint();
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [active, barTop, schedulePaint]);

  const finishDrag = (revert: boolean) => {
    const s = session.current;
    if (!s) return;
    s.stop();
    /* A release between frames still lands where the pointer let go. */
    window.cancelAnimationFrame(paintFrame.current);
    paintFrame.current = 0;
    if (!revert) paint();
    session.current = null;

    /* Where every card is seen right now, so the next render slides from
       there; then the transforms go and the cells take over. */
    const element = grid.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      const frames = Array.from(element.querySelectorAll<HTMLElement>('[data-card-id]'));
      frames.forEach((frame) => {
        const r = frame.getBoundingClientRect();
        positions.current.set(frame.dataset.cardId ?? '', {
          x: r.left - rect.left - element.clientLeft,
          y: r.top - rect.top - element.clientTop,
        });
      });
      /* Without the slide first, so clearing the transforms is not animated. */
      element.classList.remove('is-drag-active');
      frames.forEach((frame) => {
        frame.style.transform = '';
        frame.style.width = '';
        frame.style.height = '';
        delete frame.dataset.previewSize;
      });
    }

    if (s.kind === 'add') {
      ignoreClicksUntil.current = Date.now() + 300;
      const added = !revert && s.inside;
      setActive(null);
      if (!added) return;
      /* It glides in from where it was let go. */
      if (element) {
        const rect = element.getBoundingClientRect();
        positions.current.set(s.id, {
          x: pointer.current.x - s.grab.x - rect.left - element.clientLeft,
          y: pointer.current.y - s.grab.y - rect.top - element.clientTop,
        });
      }
      commit(s.next, `${t('layout.announceShown', { title: titleOf(s.id) })}. ${placedText(s.next, s.id)}`, `[data-handle-for="${s.id}"]`);
      return;
    }

    const result = revert ? s.origin : s.next;
    setActive(null);
    focusNext.current = `[data-handle-for="${s.id}"]`;
    if (!samePlacement(result, latest.current)) {
      latest.current = result;
      onChange(result);
    }
    if (!revert) announce(s.kind === 'move' ? placedText(result, s.id) : sizeText(result, s.id));
  };
  const finishRef = useRef(finishDrag);
  finishRef.current = finishDrag;

  /**
   * A press on a card's bar (move) or on one of its edges (resize). It only
   * becomes a drag once the pointer has moved a little, so a click stays a
   * click. The pointer is followed on the window, not the element: the
   * element moves as the card does, which would drop a pointer capture and
   * with it the release that ends the drag.
   */
  const onPress = (event: ReactPointerEvent<HTMLElement>, id: string, kind: DragKind, edge: Edge = 'se') => {
    if (event.button !== 0 || session.current) return;
    if (kind === 'move') {
      const target = event.target as HTMLElement;
      /* The bar's buttons stay buttons; only the handle and the bar itself drag. */
      if (target.closest('button:not(.lcard-handle), select, .lcard-menu')) return;
    }
    event.preventDefault();
    const frame = event.currentTarget.closest<HTMLElement>('[data-card-id]');
    frame?.querySelector<HTMLElement>(`[data-handle-for="${id}"]`)?.focus({ preventScroll: true });
    const rect = frame?.getBoundingClientRect();
    /* A card from the panel is held by its bar's handle: near its top-left corner. */
    const grab = rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 28, y: 0 };
    const hiddenCard = latest.current.cards.find((card) => card.id === id);
    const def = defOf(id);
    const size = kind === 'add' && hiddenCard && def ? addSize(hiddenCard, def) : { w: 0, h: 0 };
    const start = { x: event.clientX, y: event.clientY };
    const pointerId = event.pointerId;
    let started = false;

    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      pointer.current = { x: next.clientX, y: next.clientY };
      if (!started) {
        if (Math.hypot(next.clientX - start.x, next.clientY - start.y) < DRAG_THRESHOLD) return;
        started = true;
        setMenuFor(null);
        session.current = { id, kind, edge, pointerId, origin: latest.current, next: latest.current, grab, start, size, inside: false, stop };
        setActive({ id, kind });
        return;
      }
      schedulePaint();
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      pointer.current = { x: next.clientX, y: next.clientY };
      if (started) finishRef.current(false);
      else stop();
    };
    const cancel = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (started) finishRef.current(true);
      else stop();
    };
    function stop() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    pointer.current = start;
  };

  /* Leaving edit mode mid-drag still lets go of the window. */
  useEffect(
    () => () => {
      session.current?.stop();
      window.cancelAnimationFrame(paintFrame.current);
    },
    [],
  );

  /* ---- Keyboard ---- */

  const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key) || session.current) return;
    event.preventDefault();
    const layout = latest.current;
    const card = layout.cards.find((item) => item.id === id);
    const def = defOf(id);
    if (!card || !def || card.hidden) return;
    const x = card.x ?? 0;
    const y = card.y ?? 0;
    const focus = `[data-handle-for="${id}"]`;

    if (event.shiftKey) {
      /* Resize one cell. */
      const w = key === 'ArrowLeft' ? Math.max(minWidth(def), card.w - 1) : key === 'ArrowRight' ? card.w + 1 : card.w;
      const h = (card.h ?? def.defaultH) + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0);
      const next = resizeGridCard(layout, registry, id, w, h);
      /* At a limit nothing changes; say the size anyway, so the key is not silent. */
      if (!commit(next, sizeText(next, id), focus)) announce(sizeText(layout, id));
      return;
    }

    /* Move one cell; up and down swap with the card above or below, since a
       one-row step would float straight back up. */
    let next = layout;
    if (key === 'ArrowLeft') next = moveGridCard(layout, id, x - 1, y);
    else if (key === 'ArrowRight') next = moveGridCard(layout, id, x + 1, y);
    else {
      const others = layout.cards.filter((item) => item.id !== card.id && !item.hidden && sharesColumns(item, card));
      if (key === 'ArrowUp') {
        const above = others.filter((item) => (item.y ?? 0) < y);
        if (above.length) next = moveGridCard(layout, id, x, Math.max(...above.map((item) => item.y ?? 0)));
      } else {
        const below = others.filter((item) => (item.y ?? 0) > y);
        if (below.length) next = moveGridCard(layout, id, x, Math.min(...below.map((item) => item.y ?? 0)));
      }
    }
    if (!commit(next, placedText(next, id), focus)) announce(placedText(layout, id));
  };

  /* Escape: ends a drag where it started; otherwise leaves edit mode without
     saving — unless a dialog or a card's menu is open, which gets the key. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || confirmReset) return;
      /* An open ⋯ menu closes first, wherever the focus is. */
      if (menuFor) {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (overlayCount() > 0) return;
      event.preventDefault();
      if (session.current) finishDrag(true);
      else onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const closeMenu = useCallback((refocus: boolean) => {
    setMenuFor((current) => {
      if (current && refocus) focusNext.current = `[data-menu-for="${current}"]`;
      return null;
    });
  }, []);

  /** The size a card from the panel comes in at: as it was, widened if this screen needs it. */
  function addSize(card: GridCard, def: GridCardDef) {
    const size = showSize(card, def);
    return { w: Math.max(size.w, minWidth(def)), h: size.h };
  }

  const addCard = (id: string) => {
    const card = latest.current.cards.find((item) => item.id === id);
    const def = defOf(id);
    if (!card || !def) return;
    const next = showGridCard(latest.current, registry, id, undefined, addSize(card, def));
    const said = t(def.addable ? 'layout.announceAdded' : 'layout.announceShown', { title: titleOf(id) });
    commit(next, `${said}. ${placedText(next, id)}`, `[data-handle-for="${id}"]`);
  };

  /* Inert marks the card's own content as display only. */
  const inert = useCallback((element: HTMLDivElement | null) => {
    if (element) element.setAttribute('inert', '');
  }, []);

  /* ---- What gets drawn ---- */

  const shown = readingOrder(draft.cards);
  const hiddenAll = draft.cards.filter((card) => card.hidden);
  /* The page's own hidden cards; then, where the page can take another's
     cards (Home), those not on it yet, in their own group. */
  const hidden = hiddenAll.filter((card) => !defOf(card.id)?.addable);
  const addable = hiddenAll.filter((card) => defOf(card.id)?.addable);
  const hasAddable = registry.some((def) => def.addable);
  const menuCard = menuFor ? draft.cards.find((card) => card.id === menuFor && !card.hidden) : undefined;
  const menuAnchor = menuCard ? document.querySelector<HTMLElement>(`[data-menu-for="${menuCard.id}"]`) : null;

  /** A tile in the panel: click to add at the first free spot, or drag it in. */
  const widgetChip = (card: GridCard) => {
    const def = defOf(card.id);
    if (!def) return null;
    const title = titleOf(card.id);
    const size = addSize(card, def);
    return (
      <button
        key={card.id}
        type="button"
        className={cx('layout-chip layout-widget', active?.id === card.id && 'is-dragging')}
        data-show-for={card.id}
        aria-label={t(def.addable ? 'layout.addFromAnalytics' : 'layout.showCard', { title, w: size.w, h: size.h })}
        title={t('layout.addHint')}
        onPointerDown={(event) => onPress(event, card.id, 'add')}
        onDragStart={(event) => event.preventDefault()}
        onClick={() => {
          if (Date.now() < ignoreClicksUntil.current) return;
          addCard(card.id);
        }}
      >
        <Icon icon={Plus} size="sm" />
        <span className="truncate">{title}</span>
        <span className="layout-widget-size" aria-hidden="true">
          · {size.w} × {size.h}
        </span>
      </button>
    );
  };

  const cardFrame = (card: GridCard) => {
    const id = card.id;
    const def = defOf(id);
    if (!def) return null;
    const title = titleOf(id);
    const h = card.h ?? def.defaultH;
    const canWiden = minWidth(def) < GRID_COLUMNS;
    const canHeighten = !card.collapsed && def.minH < def.maxH;
    const slim = rowsOf(card) <= 1;

    return (
      <div
        key={id}
        data-card-id={id}
        className={cx(
          'lcard',
          active?.id === id && (active.kind === 'move' ? 'is-dragging' : 'is-resizing'),
          card.collapsed && 'is-collapsed',
          slim && 'is-slim',
          menuFor === id && 'has-menu',
        )}
        style={gridArea(card)}
        role="group"
        aria-label={title}
      >
        <div className="lcard-body" ref={inert}>
          {card.collapsed ? <section className="card lcollapsed" aria-hidden="true" /> : renderCard(id)}
        </div>
        <div
          className="lcard-bar"
          onPointerDown={(event) => onPress(event, id, 'move')}
          onDragStart={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="lcard-handle"
            data-handle-for={id}
            aria-label={t('layout.moveCard', { title })}
            aria-describedby={helpId}
            title={t('layout.moveHelp')}
            onKeyDown={(event) => onHandleKeyDown(event, id)}
          >
            <Icon icon={GripVertical} size="sm" />
          </button>
          <span className="lcard-title truncate" aria-hidden="true">
            {title}
          </span>
          <span className="lcard-size" aria-hidden="true">
            {card.w} × {card.collapsed ? 1 : h}
          </span>
          <button
            type="button"
            className="lcard-icon"
            aria-pressed={!!card.collapsed}
            aria-label={t(card.collapsed ? 'layout.expandCard' : 'layout.collapseCard', { title })}
            title={t(card.collapsed ? 'layout.expand' : 'layout.collapse')}
            onClick={() =>
              commit(
                setGridCardFlags(latest.current, id, { collapsed: !card.collapsed }),
                t(card.collapsed ? 'layout.announceExpanded' : 'layout.announceCollapsed', { title }),
              )
            }
          >
            <Icon icon={card.collapsed ? ChevronsUpDown : ChevronsDownUp} size="sm" />
          </button>
          {/* An added card (another page's) is removed rather than hidden: it goes
              back to its group in the panel, and Done leaves it out. */}
          <button
            type="button"
            className="lcard-icon"
            aria-label={t(def.addable ? 'layout.removeCard' : 'layout.hideCard', { title })}
            title={t(def.addable ? 'layout.remove' : 'layout.hide')}
            onClick={() =>
              commit(
                setGridCardFlags(latest.current, id, { hidden: true }),
                t(def.addable ? 'layout.announceRemoved' : 'layout.announceHidden', { title }),
                `[data-show-for="${id}"]`,
              )
            }
          >
            <Icon icon={def.addable ? X : EyeOff} size="sm" />
          </button>
          <button
            type="button"
            className="lcard-icon"
            data-menu-for={id}
            aria-haspopup="dialog"
            aria-expanded={menuFor === id}
            aria-label={t('layout.sizeOf', { title })}
            title={t('layout.size')}
            onClick={() => setMenuFor((current) => (current === id ? null : id))}
          >
            <Icon icon={MoreHorizontal} size="sm" />
          </button>
        </div>

        {/* Resizing by pointer; the keyboard has Shift + arrows and the ⋯ menu. */}
        {canWiden && (
          <span className="lcard-resize lcard-resize--e" aria-hidden="true" onPointerDown={(event) => onPress(event, id, 'resize', 'e')} />
        )}
        {canHeighten && (
          <span className="lcard-resize lcard-resize--s" aria-hidden="true" onPointerDown={(event) => onPress(event, id, 'resize', 's')} />
        )}
        {(canWiden || canHeighten) && (
          <span
            className="lcard-resize lcard-resize--se"
            aria-hidden="true"
            onPointerDown={(event) => onPress(event, id, 'resize', canWiden && canHeighten ? 'se' : canWiden ? 'e' : 's')}
          />
        )}
      </div>
    );
  };

  const menu = () => {
    if (!menuCard || !menuAnchor) return null;
    const id = menuCard.id;
    const def = defOf(id);
    if (!def) return null;
    const title = titleOf(id);
    const low = minWidth(def);
    const widths: number[] = [];
    for (let w = low; w <= GRID_COLUMNS; w += 1) widths.push(w);
    if (!widths.includes(menuCard.w)) widths.unshift(menuCard.w);
    const heights: number[] = [];
    for (let rows = def.minH; rows <= def.maxH; rows += 1) heights.push(rows);
    const h = menuCard.h ?? def.defaultH;
    return (
      <CardMenu anchor={menuAnchor} label={t('layout.sizeOf', { title })} onClose={closeMenu}>
        <label className="lcard-menu-row">
          <span>{t('layout.width')}</span>
          <Select
            className="lcard-select"
            aria-label={t('layout.widthOf', { title })}
            value={menuCard.w}
            onChange={(event) => {
              const next = resizeGridCard(latest.current, registry, id, Number(event.target.value), h);
              commit(next, sizeText(next, id));
            }}
          >
            {widths.map((w) => (
              <option key={w} value={w}>
                {t('layout.columns', { n: w })}
              </option>
            ))}
          </Select>
        </label>
        <label className="lcard-menu-row">
          <span>{t('layout.height')}</span>
          <Select
            className="lcard-select"
            aria-label={t('layout.heightOf', { title })}
            value={h}
            disabled={heights.length < 2 || !!menuCard.collapsed}
            onChange={(event) => {
              const next = resizeGridCard(latest.current, registry, id, menuCard.w, Number(event.target.value));
              commit(next, sizeText(next, id));
            }}
          >
            {heights.map((rows) => (
              <option key={rows} value={rows}>
                {t('layout.rows', { n: rows })}
              </option>
            ))}
          </Select>
        </label>
      </CardMenu>
    );
  };

  /* The cells drawn faintly while dragging: the column and row pitch. */
  const cellsStyle = active
    ? ({
        '--lcell-w': `${Math.max(0, (metrics.width - metrics.gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS)}px`,
        '--lcell-pitch-x': `${(metrics.width - metrics.gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS + metrics.gap}px`,
        '--lcell-h': `${ROW_PX}px`,
        '--lcell-pitch-y': `${ROW_PX + metrics.gap}px`,
      } as CSSProperties)
    : undefined;

  return (
    <>
      <div className="layout-editbar" style={{ top: barTop }} role="region" aria-labelledby={titleId}>
        <div className="layout-editbar-text">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="layout-editbar-title">
            {t(texts.editTitle)}
          </h2>
          <p id={helpId} className="layout-editbar-hint">
            {t('layout.editHint')}
          </p>
          {narrow && (
            <p className="layout-editbar-narrow">
              <Icon icon={Info} size="sm" />
              <span>{t('layout.narrowHint')}</span>
            </p>
          )}
        </div>

        <div className="layout-editbar-tray" role="group" aria-label={t('layout.hiddenTray')}>
          <span className="section-label">{t('layout.hiddenTray')}</span>
          {hidden.length === 0 ? (
            <span className="layout-editbar-none">{t(texts.hiddenNone)}</span>
          ) : (
            hidden.map((card) => widgetChip(card))
          )}
          {hasAddable && (
            <>
              <span className="section-label layout-editbar-group">{t('layout.fromAnalytics')}</span>
              {addable.length === 0 ? (
                <span className="layout-editbar-none">{t('layout.fromAnalyticsNone')}</span>
              ) : (
                addable.map((card) => widgetChip(card))
              )}
            </>
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

      <div ref={setGrid} className={cx(gridClassName, 'is-editing', active && 'is-drag-active')}>
        {active && <div className="lgrid-cells" style={cellsStyle} aria-hidden="true" />}
        {shown.map(cardFrame)}
        {active && (
          <div ref={placeholder} className={cx('lplaceholder', active.kind === 'resize' && 'is-resize')} aria-hidden="true">
            <span ref={placeholderSize} className="lplaceholder-size" />
          </div>
        )}
      </div>

      {menu()}

      {active?.kind === 'add' && (
        <Portal>
          <div ref={ghost} className="lwidget-ghost" aria-hidden="true">
            <Icon icon={GripVertical} size="sm" />
            <span className="truncate">{titleOf(active.id)}</span>
          </div>
        </Portal>
      )}

      <ConfirmDialog
        open={confirmReset}
        title={t(texts.resetTitle)}
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
