import { ReactNode, UIEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';

import { Icon } from './Icon';
import { cx } from '../lib/format';

/**
 * The balance hero, as a swipeable set of readings.
 *
 * ---------------------------------------------------------------------------
 * WHY SCROLL-SNAP AND NOT A CAROUSEL LIBRARY
 * ---------------------------------------------------------------------------
 * A carousel of three static panels is a scroll container with a snap rule.
 * Everything a library would add here — touch momentum, rubber-banding at the
 * ends, pointer/touch/pen input, keyboard scrolling, RTL, accessibility of the
 * scroll position — the browser already does natively and better. The whole
 * mechanism is four CSS declarations; the only JavaScript is reading back
 * which panel came to rest, because CSS cannot tell React that.
 *
 * ---------------------------------------------------------------------------
 * WHAT SLIDES AND WHAT DOES NOT
 * ---------------------------------------------------------------------------
 * The glass card, its label row and its actions stay put; only the figure and
 * its caption move. A card whose border slid with the content would read as
 * three cards being shuffled, and the refresh button would swipe away with
 * them. So the scroller is an element *inside* the card, and the header row
 * above it is shared by every view.
 *
 * ---------------------------------------------------------------------------
 * READING THE POSITION BACK
 * ---------------------------------------------------------------------------
 * `onScroll` fires continuously during a swipe, so the index is derived and
 * only written to state when it actually changes — otherwise every frame of a
 * flick would re-render the dashboard. `scrollLeft` is compared against the
 * scroller's own width rather than a measured panel width: the panels are
 * exactly one container wide by construction, which is also what makes the
 * snap points land where the dots say they do.
 */

export interface BalanceView {
  id: string;
  icon: LucideIcon;
  /** "Total net worth", "Excluding investments"… */
  label: string;
  /** Already formatted — the card does not know about currencies. */
  amount: string;
  /** The figure for assistive text and for `aria-label` on the dots. */
  value: number;
  /** One line under the figure: what this reading leaves out. */
  note?: ReactNode;
  /** Greyed like the historical hero value. */
  muted?: boolean;
  /** True while the data this view needs is still loading. */
  pending?: boolean;
}

export function SwipeableBalanceCard({
  views,
  label,
  actions,
  children,
}: {
  views: BalanceView[];
  /** The heading above the figure — the same for every view. */
  label: ReactNode;
  /** Buttons that belong to the card, not to a view (refresh, time travel). */
  actions?: ReactNode;
  /** Meta below the carousel: badges, the tax CTA. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const baseId = useId();

  const count = views.length;

  /* The set can shrink — stepping into a past month drops the goals view — and
     a scroller left parked on a panel that no longer exists would show the
     last one with the first dot lit. */
  useEffect(() => {
    if (index < count) return;
    setIndex(0);
    scroller.current?.scrollTo({ left: 0 });
  }, [count, index]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const width = element.clientWidth || 1;
    const next = Math.round(element.scrollLeft / width);
    /* Guarded: onScroll fires for every frame of a flick, and setting the same
       index each time would re-render the whole dashboard sixty times a second. */
    setIndex((current) => (current === next ? current : next));
  }, []);

  const goTo = useCallback((target: number) => {
    const element = scroller.current;
    if (!element) return;
    /* Honour the OS setting: "smooth" is the browser's own animation, and
       somebody who has asked for less motion should get the jump. */
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({
      left: target * element.clientWidth,
      behavior: reduced ? 'auto' : 'smooth',
    });
  }, []);

  const current = views[Math.min(index, count - 1)] ?? views[0];

  return (
    <div className="balance-carousel">
      <div className="hero-label-row">
        <span className="section-label">{label}</span>
        {actions}
      </div>

      {/* One scroll container, three panels exactly one container wide. */}
      <div
        className="balance-track"
        ref={scroller}
        onScroll={onScroll}
        role="group"
        aria-roledescription={t('dashboard.balanceCarousel')}
        aria-label={t('dashboard.balanceCarouselHint')}
        tabIndex={0}
      >
        {views.map((view, i) => (
          <section
            key={view.id}
            className="balance-panel"
            id={`${baseId}-panel-${view.id}`}
            role="tabpanel"
            aria-labelledby={`${baseId}-dot-${view.id}`}
            /* Every panel stays in the DOM and in the accessibility tree: all
               three are real figures, and a screen reader user gets them by
               reading on rather than by simulating a swipe. */
            aria-roledescription={t('dashboard.balanceView', { index: i + 1, count })}
          >
            <span className="balance-context">
              <Icon icon={view.icon} size="sm" />
              {view.label}
            </span>
            {view.pending ? (
              <span className="balance-value-pending" aria-label={t('common.loading')} />
            ) : (
              <span className={cx('hero-value', view.muted && 'is-historical')}>{view.amount}</span>
            )}
            {view.note && <span className="balance-note">{view.note}</span>}
          </section>
        ))}
      </div>

      {/* Dots: real buttons, so the views are reachable without a pointer and
          without horizontal scrolling — and they say which reading they lead
          to rather than "slide 2". */}
      {count > 1 && (
        <div className="balance-dots" role="tablist" aria-label={t('dashboard.balanceCarousel')}>
          {views.map((view, i) => (
            <button
              key={view.id}
              type="button"
              id={`${baseId}-dot-${view.id}`}
              role="tab"
              className={cx('balance-dot', i === index && 'is-active')}
              aria-selected={i === index}
              aria-controls={`${baseId}-panel-${view.id}`}
              aria-label={view.label}
              onClick={() => goTo(i)}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {/* Announced on change for anyone not watching the figure move. */}
      <span className="sr-only" aria-live="polite">
        {current ? `${current.label}: ${current.amount}` : ''}
      </span>

      {children}
    </div>
  );
}
