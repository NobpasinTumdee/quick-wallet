/**
 * The centre button in the mobile tab bar, and the arc of shortcuts it opens.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TAB BAR NEEDED THIS
 * ---------------------------------------------------------------------------
 * Seven routes in a bar that is 320px wide on the narrowest phone we support
 * gives each one 45px — under the 44px touch minimum once padding is taken out,
 * with a label rendered at 11px that has to say "Subscriptions". The bar was
 * legible only because nobody had counted.
 *
 * So four routes keep a permanent slot and the rest move behind one control.
 * Which four is not arbitrary: they are the screens you open to *look* at
 * something, several times a day. The four behind the button — Cards, Budgets,
 * Recurring, Settings — are the ones you open to *change* something, which
 * happens weekly at most and is worth one extra gesture.
 *
 * ---------------------------------------------------------------------------
 * THE INTERACTION
 * ---------------------------------------------------------------------------
 *   press and hold the button      → the arc springs out around it
 *   slide onto a shortcut          → it highlights and lifts under the thumb
 *   release on it                  → routes immediately, no confirmation
 *
 * One continuous gesture, thumb never lifting, and no round trip through a
 * menu that has to be opened, read and then tapped. The hold is deliberately
 * short (120ms) because this is navigation, not a destructive action — the cost
 * of arming it by accident is a menu you can ignore.
 *
 * ---------------------------------------------------------------------------
 * WHY POINTER CAPTURE AND elementFromPoint
 * ---------------------------------------------------------------------------
 * The same two decisions QuickTransactionWidget makes, for the same reasons,
 * and deliberately the same shape so there is one gesture idiom in this app
 * rather than two:
 *
 *   - `setPointerCapture` on press means every move and the release land on
 *     this button even once the finger is over an arc item somewhere else.
 *   - hit-testing is therefore explicit, via `document.elementFromPoint`, which
 *     ignores capture and reports what is genuinely under the finger. Per-item
 *     `onPointerEnter` does not fire during a captured touch drag at all —
 *     which is precisely the case this exists to serve.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GESTURE IS NEVER THE ONLY PATH
 * ---------------------------------------------------------------------------
 * A drag is unusable with a keyboard, a screen reader, or an unsteady hand, and
 * navigation is not somewhere to lose people. So a plain tap opens the arc and
 * leaves it open, every item is a real <button> with a click handler, Escape
 * closes it, and the same four routes remain reachable from the desktop
 * sidebar. The gesture is the fast path, never the gate.
 */

import { LayoutGrid, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '../lib/format';
import { TranslationKey } from '../locales';
import { Route } from '../lib/router';
import { Icon } from './Icon';

/**
 * How long the button must be held before the arc arms.
 *
 * Much shorter than the 280ms QuickTransactionWidget uses. That gesture commits
 * you to writing a transaction, so it is worth being sure; this one opens a
 * menu, and the whole point of it is to feel instant. Below about 100ms it
 * starts arming on taps that were meant as taps, which is why it is not lower.
 */
const HOLD_MS = 120;

/** Movement beyond this before the hold fires reads as a scroll, not a hold. */
const SLOP_PX = 12;

/* ------------------------------------------------------------------ */
/* Arc geometry                                                        */
/* ------------------------------------------------------------------ */

/** Distance from the button's centre to each item's centre. */
const RADIUS = 112;
/**
 * The arc sweeps from 150° to 30°, measured anticlockwise from the positive
 * x-axis — an upward fan that stays clear of the bar below it.
 *
 * Not a full half-circle: at 180° and 0° the outermost items would sit level
 * with the button, overlapping the tab bar and colliding with the two links on
 * each side. Ending 30° short of horizontal lifts them clear.
 */
const ARC_START_DEG = 150;
const ARC_END_DEG = 30;

export interface Shortcut {
  route: Route;
  /** Resolved at render, not at definition — see the note on NAV in AppShell. */
  labelKey: TranslationKey;
  icon: LucideIcon;
}

/**
 * Where item `index` of `count` sits, in pixels from the button's centre.
 *
 * Computed rather than hard-coded per item so the arc stays correct if a fifth
 * shortcut is added — the failure mode of hand-placed coordinates is that they
 * keep working and quietly stop being an arc.
 */
function arcOffset(index: number, count: number): { x: number; y: number } {
  const t = count > 1 ? index / (count - 1) : 0.5;
  const degrees = ARC_START_DEG + (ARC_END_DEG - ARC_START_DEG) * t;
  const radians = (degrees * Math.PI) / 180;
  return {
    x: Math.round(RADIUS * Math.cos(radians)),
    // Negated because screen y grows downward and the arc opens upward.
    y: Math.round(-RADIUS * Math.sin(radians)),
  };
}

type Phase =
  /** Closed. */
  | 'idle'
  /** Held down, hold timer running — not yet committed to a gesture. */
  | 'pressing'
  /** Arc open, finger still down. */
  | 'dragging'
  /** Arc open, finger lifted without landing on an item. Tappable. */
  | 'sticky';

export function GestureNavWidget({
  shortcuts,
  activeRoute,
  onNavigate,
}: {
  shortcuts: Shortcut[];
  activeRoute: Route;
  onNavigate: (route: Route) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  /** Which item the finger is currently over, or null. */
  const [hovered, setHovered] = useState<Route | null>(null);

  const holdTimer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  /** Mirrors `phase` for the pointer handlers, which run outside React's
   *  render and would otherwise read a stale closure. */
  const phaseRef = useRef<Phase>('idle');

  const setPhaseNow = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const open = phase === 'dragging' || phase === 'sticky';

  const reset = useCallback(() => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    origin.current = null;
    setHovered(null);
    setPhaseNow('idle');
  }, [setPhaseNow]);

  useEffect(
    () => () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
    },
    [],
  );

  /* Escape closes it — the one keyboard affordance a pointer gesture owes you. */
  useEffect(() => {
    if (phase === 'idle') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, reset]);

  /** A short tick as the thumb crosses onto an item. Silent where unsupported. */
  function pulse(): void {
    navigator.vibrate?.(8);
  }

  const go = useCallback(
    (route: Route) => {
      reset();
      onNavigate(route);
    },
    [reset, onNavigate],
  );

  /* ------------------------------------------------------------------ */
  /* The gesture                                                         */
  /* ------------------------------------------------------------------ */

  /** What the finger is over right now, or null. */
  function routeAt(x: number, y: number): Route | null {
    const element = document.elementFromPoint(x, y);
    const item = element?.closest<HTMLElement>('[data-gnav-route]');
    return (item?.dataset.gnavRoute as Route | undefined) ?? null;
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    // Ignore secondary mouse buttons; a right-click is not a hold.
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY };

    // Pressing again while open re-arms the drag rather than closing, so a
    // second look at the arc does not cost a full open-close-open cycle.
    setPhaseNow('pressing');

    holdTimer.current = window.setTimeout(() => {
      setPhaseNow('dragging');
      setHovered(null);
      pulse();
    }, HOLD_MS);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const current = phaseRef.current;

    if (current === 'pressing') {
      // Moved before the hold fired: the user is scrolling the page, not
      // opening a menu. Stand down rather than hijacking the drag.
      const start = origin.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) reset();
      return;
    }

    if (current !== 'dragging') return;

    const route = routeAt(event.clientX, event.clientY);
    setHovered((previous) => {
      if (previous === route) return previous;
      // Only on arrival, so dragging along one item does not buzz continuously.
      if (route) pulse();
      return route;
    });
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;

    const current = phaseRef.current;

    /* Released before the hold fired — a plain tap. Toggle, so tapping is a
       complete way to use this and not merely a failed drag. */
    if (current === 'pressing') {
      if (open) reset();
      else {
        setHovered(null);
        setPhaseNow('sticky');
      }
      return;
    }

    if (current !== 'dragging') return;

    const route = routeAt(event.clientX, event.clientY);
    if (route) {
      go(route);
      return;
    }

    /* Released somewhere harmless. Leave the arc open and tappable rather than
       closing — throwing the menu away over a mistimed lift is the most
       annoying thing a gesture can do. */
    setPhaseNow('sticky');
  }

  /** The OS cancelled the gesture (a call arrived, the app backgrounded). */
  function onPointerCancel() {
    reset();
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  /* When a hidden route is the current page the button wears its icon, so the
     bar still answers "where am I" — otherwise four of the app's eight screens
     would show no active state anywhere on a phone. */
  const activeShortcut = shortcuts.find((item) => item.route === activeRoute);
  const TriggerIcon = activeShortcut?.icon ?? LayoutGrid;

  return (
    <div className={cx('gnav', open && 'is-open', phase === 'dragging' && 'is-dragging')}>
      {/* Closes on an outside tap. Invisible to hit-testing while the finger is
          down: `elementFromPoint` returns the topmost element, and a backdrop
          over the arc would make every item unreachable. */}
      {open && (
        <div
          className={cx('gnav-backdrop', phase === 'dragging' && 'is-passthrough')}
          onPointerDown={reset}
          aria-hidden="true"
        />
      )}

      <div className="gnav-anchor">
        <div className="gnav-arc" role="menu" aria-label={t('nav.more')} aria-hidden={!open}>
          {shortcuts.map((item, index) => {
            const { x, y } = arcOffset(index, shortcuts.length);
            return (
              <button
                key={item.route}
                type="button"
                role="menuitem"
                data-gnav-route={item.route}
                className={cx(
                  'gnav-item',
                  hovered === item.route && 'is-hovered',
                  activeRoute === item.route && 'is-current',
                )}
                /* Position and stagger ride on custom properties so the
                   stylesheet owns the animation and this owns only the
                   geometry. Both animated properties are transform/opacity, so
                   the whole arc stays on the compositor. */
                style={
                  {
                    '--gnav-x': `${x}px`,
                    '--gnav-y': `${y}px`,
                    '--gnav-delay': `${index * 22}ms`,
                  } as React.CSSProperties
                }
                tabIndex={open ? 0 : -1}
                onClick={() => go(item.route)}
              >
                <span className="gnav-item-icon">
                  <Icon icon={item.icon} size="sm" />
                </span>
                <span className="gnav-item-label">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className={cx(
            'gnav-trigger',
            phase === 'pressing' && 'is-pressing',
            open && 'is-open',
            activeShortcut && 'is-current',
          )}
          aria-haspopup="menu"
          aria-expanded={open}
          /* Interpolated through i18next rather than assembled with template
             literals: word order around the label is not the same in every
             language, and a concatenation hard-codes English word order into
             something a translator cannot reach. */
          aria-label={
            activeShortcut
              ? t('nav.moreCurrent', { label: t(activeShortcut.labelKey) })
              : t('nav.more')
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          /* The gesture owns this element's touch behaviour entirely: without
             it the browser claims the drag for scroll or pull-to-refresh and
             the pointer stream stops mid-gesture. */
          style={{ touchAction: 'none' }}
        >
          <span className="gnav-trigger-icon">
            <Icon icon={TriggerIcon} />
          </span>
        </button>
      </div>
    </div>
  );
}
