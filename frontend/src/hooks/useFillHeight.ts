import { useLayoutEffect, useRef, useState } from 'react';

/** How often a filling chart follows its card's size, at most (first and last change included). */
export const FILL_THROTTLE_MS = 120;

/**
 * A chart that fills its card (a card placed in grid rows on the desktop):
 * the plot gets whatever height the card body has left after everything
 * else in the chart — its figures, legend, sliders. Those do not depend on
 * the plot's height, so one measurement settles it. Later size changes (a
 * card being resized in edit mode, the window) are followed at most every
 * FILL_THROTTLE_MS, first and last included, so a resize never re-draws the
 * chart on every frame.
 *
 * `rootRef` goes on the chart's outer element, a direct child of the card
 * body; `plotSelector` finds the plot inside it. Answers null when not
 * filling (the chart keeps its own fixed height) or not measured yet.
 */
export function useFillHeight(
  active: boolean,
  plotSelector: string,
  minHeight: number,
  /** Anything that changes the chart's other content (data arriving, a view switch). */
  key: unknown = null,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const body = root?.parentElement;
    if (!active || !root || !body) return undefined;
    const measure = () => {
      const plot = root.querySelector<HTMLElement>(plotSelector);
      if (!plot) return;
      const style = getComputedStyle(body);
      const room = body.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
      const chrome = root.offsetHeight - plot.offsetHeight;
      const next = Math.max(minHeight, Math.floor(room - chrome));
      setHeight((current) => (current === next ? current : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let timer = 0;
    let last = 0;
    const run = () => {
      timer = 0;
      last = Date.now();
      measure();
    };
    const observer = new ResizeObserver(() => {
      if (timer) return;
      const wait = Math.max(0, FILL_THROTTLE_MS - (Date.now() - last));
      timer = window.setTimeout(run, wait);
    });
    observer.observe(body);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [active, plotSelector, minHeight, key]);
  return { rootRef, height: active ? height : null };
}
