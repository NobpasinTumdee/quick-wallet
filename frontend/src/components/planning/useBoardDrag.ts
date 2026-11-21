import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { motionMode } from '../../lib/motion';
import { pushOverlay, type OverlayHandle } from '../../lib/overlayStack';
import { type BoardSpot, columnItems, moveItemLocal, reorderStatusesLocal, shiftId, statusesOf, stepSpot } from '../../lib/planning/model';
import { fullDropIndex } from '../../lib/planning/filters';
import type { PlanItem, PlanningData } from '../../types/planning';

/**
 * Drag and drop on the board: cards between and within columns, and the
 * columns themselves. Hand-built on pointer events, like the Home layout
 * editor (no library):
 *
 *  - mouse: a press becomes a drag after DRAG_THRESHOLD px, so a click is a click
 *  - touch: a long-press (LONG_PRESS_MS without moving) starts it, so a swipe
 *    still scrolls; the board then blocks touch scrolling until the drop
 *  - keyboard: Space picks up, arrows move, Space drops, Escape cancels
 *
 * While a drag is on, the board is drawn from a *preview*: the data with the
 * card (or column) already where it would land, shown there as the
 * placeholder. A pointer drag also has a floating copy under the finger. The
 * drop hands the target to the store, which sends the neighbours' ids.
 *
 * The pointer is followed on the window (the card under it moves as the
 * preview changes, which would drop a pointer capture). Escape and Back (the
 * drag is an entry on the overlay stack) put everything back as it was.
 */

const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 350;
const LONG_PRESS_SLOP = 8;
const EDGE = 48;
/** Touch: how long the finger rests at the board's edge before it pages a column over. */
const EDGE_DWELL_MS = 400;
/** No drag ever starts from these. */
const NO_DRAG = 'input, textarea, select, a, [contenteditable="true"], button:not([data-col-grab]), .plan-quick, .plan-col-menu';

export type DragSession =
  | { kind: 'card'; id: string; pointer: boolean; origin: BoardSpot; target: BoardSpot }
  | { kind: 'column'; id: string; pointer: boolean; origin: number; target: number };

export interface DragFloat {
  width: number;
  height: number;
  grab: { x: number; y: number };
}

interface Options {
  boardRef: RefObject<HTMLElement | null>;
  data: PlanningData;
  projectId: string;
  onDropCard: (id: string, spot: BoardSpot) => void;
  onDropColumn: (ids: string[]) => void;
  /** For the aria-live region. */
  announce: (event: DragAnnouncement) => void;
  /**
   * While filters hide cards: which ones are on screen. Drops and arrow keys
   * count visible cards only; the target is kept as a place in the whole
   * column, so the store's neighbours are always the real, adjacent ones.
   */
  isVisible?: (item: PlanItem) => boolean;
}

export type DragAnnouncement =
  | { type: 'pickedCard' | 'movedCard' | 'droppedCard'; id: string; spot: BoardSpot }
  | { type: 'cancelledCard'; id: string }
  | { type: 'pickedColumn' | 'movedColumn' | 'droppedColumn'; id: string; index: number; total: number }
  | { type: 'cancelledColumn'; id: string };

function spotOf(data: PlanningData, id: string): BoardSpot | null {
  const item = data.items.find((i) => i.id === id);
  if (!item) return null;
  return { statusId: item.statusId, index: columnItems(data, item.statusId).findIndex((i) => i.id === id) };
}

function sameSpot(a: BoardSpot, b: BoardSpot): boolean {
  return a.statusId === b.statusId && a.index === b.index;
}

export function previewOf(data: PlanningData, projectId: string, session: DragSession | null): PlanningData {
  if (!session) return data;
  if (session.kind === 'card') return moveItemLocal(data, session.id, session.target.statusId, session.target.index, new Date().toISOString());
  const ids = statusesOf(data, projectId).map((s) => s.id);
  return reorderStatusesLocal(data, projectId, shiftId(ids, session.id, session.target - ids.indexOf(session.id)));
}

export function useBoardDrag({ boardRef, data, projectId, onDropCard, onDropColumn, announce, isVisible }: Options) {
  const [session, setSessionState] = useState<DragSession | null>(null);
  const [float, setFloat] = useState<DragFloat | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const floatRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const grabRef = useRef({ x: 0, y: 0 });
  const frame = useRef(0);
  const overlay = useRef<OverlayHandle | null>(null);
  const stopListening = useRef<() => void>(() => undefined);
  /** A drag (or a long-press) just ended: the click that follows is not a tap. */
  const suppressUntil = useRef(0);
  const callbacks = useRef({ onDropCard, onDropColumn, announce });
  callbacks.current = { onDropCard, onDropColumn, announce };
  const visibleRef = useRef(isVisible);
  visibleRef.current = isVisible;

  /** A column's cards without the moved one: all of them, and the ones on screen. */
  const columnOf = useCallback((statusId: string, without: string) => {
    const full = columnItems(dataRef.current, statusId).filter((i) => i.id !== without);
    const visible = visibleRef.current;
    return { full, visible: visible ? full.filter(visible) : full };
  }, []);

  /** A place among the visible cards → a place in the whole column. */
  const toFull = useCallback(
    (s: Extract<DragSession, { kind: 'card' }>, statusId: string, visibleIndex: number): number => {
      const { full, visible } = columnOf(statusId, s.id);
      if (!visibleRef.current) return visibleIndex;
      /* Where it started counts as "not moved", hidden cards around it and all. */
      if (statusId === s.origin.statusId) {
        const before = visible.filter((c) => full.indexOf(c) < s.origin.index).length;
        if (visibleIndex === before) return s.origin.index;
      }
      return fullDropIndex(full, visible, visibleIndex);
    },
    [columnOf],
  );

  /** A place in the whole column → how many visible cards are above it. */
  const toVisible = useCallback(
    (id: string, spot: BoardSpot): number => {
      const { full, visible } = columnOf(spot.statusId, id);
      return visible.filter((c) => full.indexOf(c) < spot.index).length;
    },
    [columnOf],
  );

  const setSession = useCallback((next: DragSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  /* ---- Ending ---- */

  const finish = useCallback(
    (revert: boolean) => {
      const s = sessionRef.current;
      if (!s) return;
      stopListening.current();
      stopListening.current = () => undefined;
      window.cancelAnimationFrame(frame.current);
      frame.current = 0;
      const handle = overlay.current;
      overlay.current = null;
      handle?.release();
      if (s.pointer) suppressUntil.current = Date.now() + 400;
      setSession(null);
      setFloat(null);
      const cb = callbacks.current;
      if (!s.pointer) {
        pendingFocus.current = s.kind === 'card' ? `[data-item-id="${CSS.escape(s.id)}"]` : `[data-col-grab="${CSS.escape(s.id)}"]`;
      }
      if (s.kind === 'card') {
        if (revert || sameSpot(s.origin, s.target)) {
          if (revert) cb.announce({ type: 'cancelledCard', id: s.id });
          return;
        }
        cb.onDropCard(s.id, s.target);
        cb.announce({ type: 'droppedCard', id: s.id, spot: s.target });
      } else {
        const ids = statusesOf(dataRef.current, projectId).map((st) => st.id);
        if (revert || s.origin === s.target) {
          if (revert) cb.announce({ type: 'cancelledColumn', id: s.id });
          return;
        }
        cb.onDropColumn(shiftId(ids, s.id, s.target - ids.indexOf(s.id)));
        cb.announce({ type: 'droppedColumn', id: s.id, index: s.target, total: ids.length });
      }
    },
    [projectId, setSession],
  );

  const begin = useCallback(
    (next: DragSession) => {
      setSession(next);
      /* Back on a phone, like a sheet: the top of the overlay stack cancels. */
      overlay.current = pushOverlay(() => finish(true), { lockScroll: false });
      const total = statusesOf(dataRef.current, projectId).length;
      if (next.kind === 'card') callbacks.current.announce({ type: 'pickedCard', id: next.id, spot: next.origin });
      else callbacks.current.announce({ type: 'pickedColumn', id: next.id, index: next.origin, total });
    },
    [finish, projectId, setSession],
  );

  /* ---- Where the pointer would drop ---- */

  const targetAt = useCallback((s: DragSession, x: number, y: number): DragSession => {
    const board = boardRef.current;
    if (!board) return s;
    const columns = Array.from(board.querySelectorAll<HTMLElement>('[data-col-id]'));
    if (!columns.length) return s;
    if (s.kind === 'column') {
      const others = columns.filter((c) => c.dataset.colId !== s.id);
      const index = others.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left + r.width / 2 < x;
      }).length;
      return index === s.target ? s : { ...s, target: index };
    }
    let column = columns.find((c) => {
      const r = c.getBoundingClientRect();
      return x >= r.left && x <= r.right;
    });
    if (!column) {
      column = columns.reduce((best, c) => {
        const r = c.getBoundingClientRect();
        const b = best.getBoundingClientRect();
        const d = Math.min(Math.abs(x - r.left), Math.abs(x - r.right));
        const db = Math.min(Math.abs(x - b.left), Math.abs(x - b.right));
        return d < db ? c : best;
      });
    }
    const statusId = column.dataset.colId as string;
    const cards = Array.from(column.querySelectorAll<HTMLElement>('[data-item-id]')).filter((c) => c.dataset.itemId !== s.id);
    const shownIndex = cards.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.top + r.height / 2 < y;
    }).length;
    const target = { statusId, index: toFull(s, statusId, shownIndex) };
    return sameSpot(target, s.target) ? s : { ...s, target };
  }, [boardRef, toFull]);

  /* ---- A frame: the floating copy follows, the target updates ---- */

  const paint = useCallback(() => {
    frame.current = 0;
    const s = sessionRef.current;
    if (!s || !s.pointer) return;
    const { x, y } = pointer.current;
    const node = floatRef.current;
    if (node) node.style.transform = `translate3d(${x - grabRef.current.x}px, ${y - grabRef.current.y}px, 0)`;
    const next = targetAt(s, x, y);
    if (next !== s) setSession(next);
  }, [setSession, targetAt]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = window.requestAnimationFrame(paint);
  }, [paint]);

  /* Auto-scroll near the edges while a pointer drag is on: the board
     sideways, the column under the pointer up and down. */
  const touchDrag = useRef(false);
  useEffect(() => {
    if (!session?.pointer) return undefined;
    let raf = 0;
    let edgeSince = 0;
    let edgeSide = 0;
    const tick = () => {
      const board = boardRef.current;
      const { x, y } = pointer.current;
      if (board) {
        const r = board.getBoundingClientRect();
        const side = x < r.left + EDGE ? -1 : x > r.right - EDGE ? 1 : 0;
        if (touchDrag.current) {
          /* A finger at the edge pages one column over, after a short rest. */
          if (side !== edgeSide) {
            edgeSide = side;
            edgeSince = performance.now();
          } else if (side && performance.now() - edgeSince > EDGE_DWELL_MS) {
            const col = board.querySelector<HTMLElement>('[data-col-id]');
            board.scrollBy({ left: side * (col?.getBoundingClientRect().width ?? 280), behavior: motionMode() === 'full' ? 'smooth' : 'auto' });
            edgeSince = performance.now();
            schedule();
          }
        } else if (side) {
          const depth = side < 0 ? r.left + EDGE - x : x - (r.right - EDGE);
          board.scrollLeft += side * Math.ceil(Math.min(EDGE, depth) / 4);
          schedule();
        }
        const body = document.elementsFromPoint(x, y).find((el) => (el as HTMLElement).dataset?.colBody !== undefined) as HTMLElement | undefined;
        if (body) {
          const b = body.getBoundingClientRect();
          const step = y < b.top + EDGE ? -Math.ceil((b.top + EDGE - y) / 4) : y > b.bottom - EDGE ? Math.ceil((y - (b.bottom - EDGE)) / 4) : 0;
          if (step) {
            body.scrollTop += step;
            schedule();
          }
        }
        /* The window too, near its own top and bottom (the phone's page scrolls). */
        const wStep = y < 64 ? -8 : y > window.innerHeight - 64 ? 8 : 0;
        if (wStep) {
          window.scrollBy(0, wStep);
          schedule();
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [session?.pointer, boardRef, schedule]);

  /* While a touch drag is on, the board must not scroll under the finger.
     A non-passive listener that is always there (it must exist before the
     touch starts for the browser to honour it) and only acts mid-drag. */
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return undefined;
    const block = (event: TouchEvent) => {
      if (sessionRef.current?.pointer) event.preventDefault();
    };
    board.addEventListener('touchmove', block, { passive: false });
    return () => board.removeEventListener('touchmove', block);
  }, [boardRef]);

  /* Escape ends a drag where it started. */
  useEffect(() => {
    if (!session) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [session, finish]);

  /* Leaving the board mid-drag lets go of everything. */
  useEffect(
    () => () => {
      stopListening.current();
      window.cancelAnimationFrame(frame.current);
      overlay.current?.release();
    },
    [],
  );

  /* ---- Pointer ---- */

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, what: { kind: 'card' | 'column'; id: string }) => {
      if (sessionRef.current) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if ((event.target as Element).closest(NO_DRAG)) return;
      const el = event.currentTarget;
      const rect = el.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY };
      const touch = event.pointerType !== 'mouse';
      const pointerId = event.pointerId;
      let started = false;
      let timer = 0;
      pointer.current = start;

      const startDrag = () => {
        const current = dataRef.current;
        let next: DragSession;
        if (what.kind === 'card') {
          const spot = spotOf(current, what.id);
          if (!spot) return;
          next = { kind: 'card', id: what.id, pointer: true, origin: spot, target: spot };
        } else {
          const index = statusesOf(current, projectId).findIndex((s) => s.id === what.id);
          if (index < 0) return;
          next = { kind: 'column', id: what.id, pointer: true, origin: index, target: index };
        }
        started = true;
        touchDrag.current = touch;
        grabRef.current = { x: start.x - rect.left, y: start.y - rect.top };
        setFloat({ width: rect.width, height: rect.height, grab: grabRef.current });
        if (touch && 'vibrate' in navigator) {
          try {
            navigator.vibrate(10);
          } catch {
            /* Not allowed here: no buzz. */
          }
        }
        /* Not a text selection, now that the press is a drag. */
        window.getSelection()?.removeAllRanges();
        begin(next);
        schedule();
      };

      const move = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        pointer.current = { x: next.clientX, y: next.clientY };
        const dist = Math.hypot(next.clientX - start.x, next.clientY - start.y);
        if (!started) {
          if (touch) {
            /* Moved before the long-press: it is a scroll, not a drag. */
            if (dist > LONG_PRESS_SLOP) stop();
          } else if (dist >= DRAG_THRESHOLD) {
            startDrag();
          }
          return;
        }
        schedule();
      };
      const up = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        if (started) {
          pointer.current = { x: next.clientX, y: next.clientY };
          window.cancelAnimationFrame(frame.current);
          paint();
          finish(false);
        } else {
          stop();
        }
      };
      const cancel = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        if (started) finish(true);
        else stop();
      };
      function stop() {
        window.clearTimeout(timer);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      }
      stopListening.current = stop;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      if (touch) timer = window.setTimeout(startDrag, LONG_PRESS_MS);
    },
    [begin, finish, paint, projectId, schedule],
  );

  /** True right after a drag or long-press: the click it ends in is not a tap. */
  const consumeClick = useCallback(() => Date.now() < suppressUntil.current, []);

  /* ---- Keyboard ---- */

  /* A card or column moved by keyboard is a new element in its new place:
     focus it once React has committed (not on a frame, which a background
     tab may never draw). */
  const pendingFocus = useRef<string | null>(null);
  const focusLater = (selector: string) => {
    pendingFocus.current = selector;
  };
  useLayoutEffect(() => {
    const selector = pendingFocus.current;
    if (!selector) return;
    const el = boardRef.current?.querySelector<HTMLElement>(selector);
    if (el && document.activeElement !== el) el.focus({ preventScroll: false });
    if (el) pendingFocus.current = null;
  });

  const onCardKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, id: string, open: () => void) => {
      if (event.target !== event.currentTarget) return;
      const s = sessionRef.current;
      const current = dataRef.current;
      if (!s) {
        if (event.key === 'Enter') {
          event.preventDefault();
          open();
        } else if (event.key === ' ') {
          event.preventDefault();
          const spot = spotOf(current, id);
          if (spot) begin({ kind: 'card', id, pointer: false, origin: spot, target: spot });
        }
        return;
      }
      if (s.kind !== 'card' || s.id !== id) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        finish(false);
        focusLater(`[data-item-id="${CSS.escape(id)}"]`);
        return;
      }
      if (event.key === 'Tab') {
        finish(true);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const columns = statusesOf(current, projectId).map((st) => st.id);
        const sizes: Record<string, number> = {};
        columns.forEach((c) => {
          sizes[c] = columnOf(c, id).visible.length;
        });
        /* Steps over the cards on screen; hidden ones are passed by. */
        const step = stepSpot({ statusId: s.target.statusId, index: toVisible(id, s.target) }, event.key, columns, sizes);
        const target = { statusId: step.statusId, index: toFull(s, step.statusId, step.index) };
        if (!sameSpot(target, s.target)) {
          setSession({ ...s, target });
          callbacks.current.announce({ type: 'movedCard', id, spot: target });
          focusLater(`[data-item-id="${CSS.escape(id)}"]`);
        }
      }
    },
    [begin, columnOf, finish, projectId, setSession, toFull, toVisible],
  );

  const onColumnKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, id: string) => {
      const s = sessionRef.current;
      const ids = statusesOf(dataRef.current, projectId).map((st) => st.id);
      if (!s) {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          const index = ids.indexOf(id);
          begin({ kind: 'column', id, pointer: false, origin: index, target: index });
        }
        return;
      }
      if (s.kind !== 'column' || s.id !== id) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        finish(false);
        focusLater(`[data-col-grab="${CSS.escape(id)}"]`);
      } else if (event.key === 'Tab') {
        finish(true);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const target = Math.max(0, Math.min(ids.length - 1, s.target + (event.key === 'ArrowLeft' ? -1 : 1)));
        if (target !== s.target) {
          setSession({ ...s, target });
          callbacks.current.announce({ type: 'movedColumn', id, index: target, total: ids.length });
          focusLater(`[data-col-grab="${CSS.escape(id)}"]`);
        }
      }
    },
    [begin, finish, projectId, setSession],
  );

  return { session, float, floatRef, onPointerDown, onCardKeyDown, onColumnKeyDown, consumeClick, cancel: () => finish(true) };
}
