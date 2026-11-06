import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cx } from '../../lib/format';
import { Portal, useOverlay } from '../ui';

/**
 * A small panel pinned to the button that opened it: the colour palette,
 * the More menu, the phone's Aa and + panels, the table picker, the
 * template menu.
 *
 * It never takes focus. Every press inside it cancels `mousedown`, so the
 * note body keeps the caret and the phone keyboard stays up while a tool is
 * picked. It opens on whichever side of the button has more room — above
 * the bar docked over the keyboard, below a bar at the top — inside the
 * visible screen, never wider than it. It sits on the shared overlay stack,
 * so the phone's Back closes it and nothing behind it.
 */
export function ToolPanel({
  open,
  anchor,
  onClose,
  label,
  wide = false,
  className,
  children,
}: {
  open: boolean;
  /** The button it belongs to. */
  anchor: HTMLElement | null;
  onClose: () => void;
  label: string;
  /** As wide as the screen allows (up to 480px), for the phone panels. */
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const handle = useOverlay(open, onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPlace(null);
      return undefined;
    }
    const measure = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const vv = window.visualViewport;
      const viewTop = vv?.offsetTop ?? 0;
      const viewBottom = viewTop + (vv?.height ?? window.innerHeight);
      const viewW = document.documentElement.clientWidth;
      const margin = 8;
      const gap = 6;
      const a = anchor.getBoundingClientRect();
      const width = wide ? Math.min(viewW - margin * 2, 480) : Math.min(panel.scrollWidth, viewW - margin * 2);
      const roomAbove = a.top - viewTop - margin - gap;
      const roomBelow = viewBottom - a.bottom - margin - gap;
      const above = roomAbove > roomBelow;
      const centre = a.left + a.width / 2;
      const left = Math.min(Math.max(margin, centre - width / 2), viewW - margin - width);
      setPlace({
        left,
        width,
        maxHeight: Math.max(120, above ? roomAbove : roomBelow),
        ...(above
          ? { bottom: window.innerHeight - (a.top - gap) }
          : { top: a.bottom + gap }),
      });
    };
    measure();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => {
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [open, anchor, wide]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (handle && !handle.isTop())) return;
      event.stopPropagation();
      event.preventDefault();
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchor, onClose, handle]);

  if (!open) return null;

  return (
    <Portal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        className={cx('tool-panel', wide && 'is-wide', className)}
        style={{
          ...(place ?? { left: 0, top: 0 }),
          visibility: place ? 'visible' : 'hidden',
          zIndex: `calc(var(--z-popover) + ${handle?.depth ?? 0})`,
        }}
        onMouseDown={(event) => {
          /* Keep the note's caret and the keyboard: only real fields may take focus. */
          if (!(event.target as HTMLElement).closest('input, textarea, select')) event.preventDefault();
        }}
      >
        {children}
      </div>
    </Portal>
  );
}
