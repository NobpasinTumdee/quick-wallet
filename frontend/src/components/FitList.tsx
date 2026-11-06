import { ReactNode, useLayoutEffect, useRef, useState } from 'react';

/**
 * A list that shows as many rows as fit its card — the desktop Home layout
 * with free placement, where a card's height is set in grid rows and its
 * content adapts.
 *
 * Off (`active` false — phones, tablets, the default and first-version
 * layouts) it is exactly the markup the card had before: one element with
 * `className`, the first `fallback` items. On, it measures the card body it
 * sits in (its parent), works out how many rows fit with room left for the
 * "more" link, and shows that many — never a half row. The body still
 * scrolls if a row turns out taller than measured (a long name wrapping),
 * so nothing is ever cut off without a way to reach it.
 */
export function FitList<T>({
  items,
  fallback,
  active,
  className,
  renderItem,
  more,
}: {
  items: readonly T[];
  /** Rows shown when not fitting — what the card always showed. */
  fallback: number;
  active: boolean;
  className: string;
  renderItem: (item: T, index: number) => ReactNode;
  /** The link shown under the list when some rows do not fit. */
  more?: (hidden: number) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(() => Math.min(items.length, fallback));
  const total = items.length;
  const hasMore = Boolean(more);

  useLayoutEffect(() => {
    if (!active) return undefined;
    const list = listRef.current;
    const body = list?.parentElement;
    if (!list || !body) return undefined;

    const measure = () => {
      const kids = Array.from(list.children) as HTMLElement[];
      if (kids.length === 0) {
        setCount((current) => (current === Math.min(total, 1) ? current : Math.min(total, 1)));
        return;
      }
      const style = getComputedStyle(body);
      /* From the top of the list to the bottom of the body's content box. */
      const bottom = body.offsetTop + body.clientHeight - (parseFloat(style.paddingBottom) || 0);
      const room = bottom - list.offsetTop;
      const itemHeight = Math.max(...kids.map((kid) => kid.offsetHeight));
      const pitch =
        kids.length > 1
          ? Math.max(itemHeight, kids[1].offsetTop - kids[0].offsetTop)
          : itemHeight + (parseFloat(getComputedStyle(list).rowGap) || 0);
      const fits = (space: number) => (space < itemHeight ? 0 : 1 + Math.floor((space - itemHeight) / pitch + 0.001));

      let next = fits(room);
      if (next < total && hasMore) {
        const link = moreRef.current;
        const reserve = link ? link.offsetHeight + Math.max(0, link.offsetTop - (list.offsetTop + list.offsetHeight)) : 40;
        next = fits(room - reserve);
      }
      next = Math.max(1, Math.min(total, next));
      setCount((current) => (current === next ? current : next));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    });
    observer.observe(body);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [active, total, count, hasMore]);

  if (!active) return <div className={className}>{items.slice(0, fallback).map(renderItem)}</div>;

  const shown = items.slice(0, Math.min(count, total));
  const hidden = total - shown.length;
  return (
    <>
      <div ref={listRef} className={className}>
        {shown.map(renderItem)}
      </div>
      {hidden > 0 && more && (
        <div ref={moreRef} className="fit-more">
          {more(hidden)}
        </div>
      )}
    </>
  );
}
