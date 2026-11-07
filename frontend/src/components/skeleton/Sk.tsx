import { CSSProperties, ElementType, ReactNode, RefObject, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '../../lib/format';
import { useMobileV2 } from '../../lib/mobileLayout';
import { heightScope, rememberHeights, rememberedHeight } from '../../lib/skeletonHeights';
import { useAuth } from '../../state/AuthContext';

/**
 * Skeleton building blocks.
 *
 * Shapes are drawn inside the real elements with their real classes (a card's
 * `card-head`, a metric's `metric-value`, a list's `list-item`), so the
 * spacing, line heights and grid placement are the loaded page's own and
 * nothing moves when the data lands. `SkT` is a line of text: the element
 * keeps its class, and therefore its line height, with a block where the
 * words will be.
 *
 * The sweep is one layer per skeleton card: a band moved with transform,
 * clipped to that card's blocks by a mask built from where they are drawn.
 * Nothing per block animates, and the band runs on the compositor. Reduced
 * motion and Off show the blocks still (see CSS).
 */

/** A block: a bar, a dot, an avatar, a chart's column. */
export function Sk({
  w,
  h,
  r,
  className,
  style,
}: {
  w?: number | string;
  h?: number | string;
  r?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return <span className={cx('sk', className)} style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

/** A line of text in an element of the real class: its line height, a block for the words. */
export function SkT({
  as: Tag = 'span',
  className,
  w = '60%',
}: {
  as?: ElementType;
  className?: string;
  w?: number | string;
}) {
  return (
    /* The inner span holds a line of text even where the element is a flex
       or grid container (a flex item would shrink to the block's own height). */
    <Tag className={cx(className, 'sk-t')}>
      <span className="sk-line">
        <span className="sk sk-ink" style={{ width: w }} />
      </span>
    </Tag>
  );
}

/** A card's header as the real one draws it: title, subtitle, actions. */
export function SkHead({
  title = '9em',
  subtitle = '12em',
  action,
  segmented,
  picker,
}: {
  title?: string | number;
  subtitle?: string | number | false;
  /** A small button's width in the actions. */
  action?: number | false;
  /** A segmented control's width in the actions (taller than a button). */
  segmented?: number;
  /** A range picker in the actions (RangePicker's frame). */
  picker?: boolean;
}) {
  return (
    <header className="card-head">
      <div>
        <SkT as="h2" className="card-title" w={title} />
        {subtitle !== false && <SkT as="p" className="card-subtitle" w={subtitle} />}
      </div>
      {action || segmented || picker ? (
        <div className="card-actions">
          {picker ? (
            /* RangePicker's own frame: month row and range tabs, which stack
               on a narrow card exactly as the real one does. */
            <div className="range-picker">
              <div className="period-nav">
                {/* The real buttons' classes, so each takes their size (taller on a phone). */}
                <span className="btn btn--ghost btn--sm">
                  <Sk w={15} h={15} r={4} />
                </span>
                <SkT className="range-picker-month" w={87} />
                <span className="btn btn--ghost btn--sm">
                  <Sk w={15} h={15} r={4} />
                </span>
              </div>
              <div className="range-tabs">
                {[0, 1, 2].map((i) => (
                  <Sk key={i} className="range-tab" w={74} h={27} r={999} />
                ))}
              </div>
            </div>
          ) : segmented ? (
            <Sk className="sk-seg" w={segmented} />
          ) : (
            <Sk className="sk-btn" w={action || undefined} />
          )}
        </div>
      ) : null}
    </header>
  );
}

/**
 * A card that is still loading: the real card frame (class names, padding),
 * its shapes, and the sweep. Hidden from screen readers; the page says
 * "Loading…" once instead. `minHeight` is the card's height when it last
 * loaded on this screen, where the height is not fixed by the layout: the
 * skeleton then takes exactly that height, its shapes cropped to it.
 */
export function SkCard({
  className,
  head,
  children,
  padded = true,
  minHeight,
  as: Tag = 'section',
}: {
  className?: string;
  head?: ReactNode;
  children?: ReactNode;
  padded?: boolean;
  minHeight?: number;
  as?: ElementType;
}) {
  return (
    <SkFrame as={Tag} className={cx('card', className)} minHeight={minHeight}>
      {head}
      <div className={padded ? 'card-body' : 'card-body card-body--flush'}>{children}</div>
    </SkFrame>
  );
}

/** Any loading region (a hero, a toolbar, a card): the frame, the shapes and one sweep. */
export function SkFrame({
  as: Tag = 'div',
  className,
  minHeight,
  frameRef,
  children,
}: {
  as?: ElementType;
  className?: string;
  minHeight?: number;
  /** The frame's element, for a caller that measures around it (SkRegion). */
  frameRef?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}) {
  const own = useRef<HTMLElement | null>(null);
  const frame = frameRef ?? own;
  return (
    <Tag ref={frame} className={cx(className, 'sk-card')} style={minHeight ? { height: minHeight, overflow: 'hidden' } : undefined} aria-hidden="true">
      {children}
      <SkSweep frame={frame} />
    </Tag>
  );
}

/** The sweep's period (ms). Kept here and in CSS (--sk-sweep-dur) in step. */
const SWEEP_MS = 1400;

/**
 * The one moving layer: a band translated across the frame, masked to the
 * blocks inside it. The mask is measured once when drawn and again when the
 * frame changes size (a rotation, a resize); the band's phase comes from the
 * clock, so every card on the page sweeps together.
 */
function SkSweep({ frame }: { frame: RefObject<HTMLElement | null> }) {
  const layer = useRef<HTMLSpanElement | null>(null);
  const band = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const host = frame.current;
    const sweep = layer.current;
    if (!host || !sweep) return undefined;
    if (band.current) band.current.style.animationDelay = `-${Math.round(performance.now() % SWEEP_MS)}ms`;

    let frameId = 0;
    const paint = () => {
      frameId = 0;
      /* Relative to the layer itself (the frame's padding box). */
      const box = sweep.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;
      const rects: string[] = [];
      host.querySelectorAll<HTMLElement>('.sk').forEach((block) => {
        const r = block.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        const radius = Math.min(parseFloat(getComputedStyle(block).borderTopLeftRadius) || 0, r.height / 2, r.width / 2);
        rects.push(
          `<rect x="${(r.left - box.left).toFixed(1)}" y="${(r.top - box.top).toFixed(1)}" width="${r.width.toFixed(1)}" height="${r.height.toFixed(1)}" rx="${radius.toFixed(1)}"/>`,
        );
      });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width.toFixed(1)}" height="${box.height.toFixed(1)}">${rects.join('')}</svg>`;
      const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      sweep.style.maskImage = url;
      sweep.style.setProperty('-webkit-mask-image', url);
    };
    paint();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (!frameId) frameId = window.requestAnimationFrame(paint);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [frame]);

  return (
    <span ref={layer} className="sk-sweep" aria-hidden="true">
      <span ref={band} className="sk-band" />
    </span>
  );
}

/** Rows of a list card: avatar, two lines, an amount. */
export function SkListRows({ rows, avatar = true, sub = true }: { rows: number; avatar?: boolean; sub?: boolean }) {
  return (
    <div className="list">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="list-item">
          {avatar && <Sk className="avatar sk-avatar" />}
          <div className="list-item-main">
            {/* In em: the title sizes to its content, so a percentage would be of nothing. */}
            <SkT className="list-item-title" w={`${7 + (i % 3) * 1.5}em`} />
            {sub && <SkT className="list-item-sub" w={`${60 + ((i * 11) % 25)}%`} />}
          </div>
          <SkT className="list-item-amount" w="5em" />
        </div>
      ))}
    </div>
  );
}

/**
 * A page's loading region (a list, a grid, a whole page): its skeleton with
 * the sweep, and one polite "Loading…" unless `announce` is off.
 *
 * Its height is remembered by the element around it, which React keeps when
 * the data replaces the skeleton: once the page has loaded and settled, that
 * parent's height is stored (per user, page and width band); next time the
 * region takes whatever height brings the parent back to it, so nothing
 * below moves when the data lands. The loaded page itself is not touched.
 */
export function SkRegion({
  page,
  id = 'main',
  as,
  className,
  announce = true,
  remember = true,
  children,
}: {
  /** The page (and `id`, the region on it) the height belongs to. */
  page: string;
  id?: string;
  as?: ElementType;
  className?: string;
  announce?: boolean;
  /** Off for a region in a dialog or popover, whose parent is not the page's. */
  remember?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const mobileV2 = useMobileV2();
  const frame = useRef<HTMLElement | null>(null);
  const userId = user?.id;

  useLayoutEffect(() => {
    const element = frame.current;
    const parent = element?.parentElement;
    if (!remember || !element || !parent || !userId) return undefined;
    const key = `${page}.${id}`;
    const scope = heightScope(key, window.innerWidth, mobileV2);
    const want = rememberedHeight(userId, scope, 'parent');
    if (want !== undefined) {
      const around = parent.getBoundingClientRect().height - element.getBoundingClientRect().height;
      const height = want - around;
      if (height >= 24) {
        element.style.height = `${height}px`;
        element.style.overflow = 'hidden';
      }
    }
    const route = window.location.hash;
    return () => {
      /* The skeleton is gone: measure its parent once the loaded page has
         settled — only if it is still this page, at this width, with no
         skeleton left in it. A card that arrived with the data may still be
         loading its own part, so a few more tries before giving up. */
      const measure = (triesLeft: number) => {
        if (!parent.isConnected || window.location.hash !== route) return;
        if (heightScope(key, window.innerWidth, mobileV2) !== scope) return;
        if (parent.querySelector('.sk-card')) {
          if (triesLeft > 0) window.setTimeout(() => measure(triesLeft - 1), 1000);
          return;
        }
        rememberHeights(userId, scope, { parent: parent.getBoundingClientRect().height });
      };
      window.setTimeout(() => measure(4), 1500);
    };
    // Once per skeleton: the measuring is about the page it stands in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <SkFrame as={as} className={className} frameRef={frame}>
        {children}
      </SkFrame>
      {announce && (
        <span className="sr-only" role="status">
          {t('common.loading')}
        </span>
      )}
    </>
  );
}
