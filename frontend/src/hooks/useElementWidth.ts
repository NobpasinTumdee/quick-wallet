import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The rendered width of an element, in CSS pixels, kept current.
 *
 * ---------------------------------------------------------------------------
 * WHY A CHART NEEDS THIS
 * ---------------------------------------------------------------------------
 * An SVG with a `viewBox` and no explicit width stretches its whole coordinate
 * system to fit the box it is in. That is fine for an icon and wrong for a
 * chart: when the content shrinks — two categories instead of ten — the
 * browser scales *everything* up, so a 12px axis label renders at 40px and a
 * single box plot fills the screen.
 *
 * The fix is to stop scaling and start laying out: measure the space, compute
 * the coordinates to fill it, and render the SVG at 1 unit per pixel so text
 * is the size it says it is.
 *
 * `useLayoutEffect` rather than `useEffect` so the first measurement happens
 * before paint. With `useEffect` the chart draws once at the fallback width
 * and then jumps, which is visible on every mount.
 */
export function useElementWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const measure = () => {
      /* `clientWidth` excludes the scrollbar, which is what we want: laying
         out to `offsetWidth` would overflow by the scrollbar's width and
         produce a horizontal scrollbar of its own, every time. */
      const next = element.clientWidth;
      if (next > 0) setWidth(next);
    };

    measure();

    /* Guarded: the test harness runs these components under a stubbed DOM
       that has no ResizeObserver, and a chart that throws on mount there
       would fail the suite for a reason that has nothing to do with it. */
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
