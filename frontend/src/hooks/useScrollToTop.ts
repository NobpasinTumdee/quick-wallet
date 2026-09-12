import { useLayoutEffect, useRef } from 'react';

/**
 * Puts a new screen at the top, the way opening a page should.
 *
 * ---------------------------------------------------------------------------
 * WHAT ACTUALLY SCROLLS HERE
 * ---------------------------------------------------------------------------
 * The **viewport**, not a wrapper. Neither `.main` nor `.page` sets an overflow,
 * `html/body/#root` are `height: 100%` and the content overflows past them, and
 * `.topbar` is `position: sticky; top: 0` — which only works at all if its
 * scrolling ancestor is the viewport. So `window.scrollTo` is the one that
 * matters.
 *
 * The wrapper sweep below is insurance rather than superstition. Putting
 * `overflow-y: auto` on `.main` is a one-line change someone will plausibly make
 * for a fixed-header layout, and the day they do, a scroll reset that only knew
 * about `window` would stop working with no error anywhere. Resetting whichever
 * of the known wrappers is *actually* scrolled costs a couple of property reads
 * and makes this self-healing.
 *
 * ---------------------------------------------------------------------------
 * WHY useLayoutEffect
 * ---------------------------------------------------------------------------
 * `useEffect` runs after paint, so the browser gets one frame showing the new
 * page at the old scroll offset before it snaps. That flash is the bug in
 * miniature. `useLayoutEffect` runs before the browser paints, so the new screen
 * is never shown anywhere but the top.
 *
 * ---------------------------------------------------------------------------
 * WHY 'instant' RATHER THAN 'auto'
 * ---------------------------------------------------------------------------
 * `auto` defers to the CSS `scroll-behavior` of the element. This app does not
 * set `scroll-behavior: smooth` today, but a stylesheet that did would turn
 * every navigation into a visible rewind through the previous page's content —
 * and it would be a genuinely confusing bug to trace back to here. `instant`
 * overrides it explicitly, so the behaviour cannot be changed from CSS.
 */

/**
 * Layout elements that could plausibly become the scroll container.
 *
 * Only ancestors of page content. Deliberately not `.modal-body` or
 * `.card--fullscreen .card-body`: those scroll too, but they belong to
 * something open *over* the page, and a route change cannot happen while one is.
 */
const WRAPPER_SELECTORS = ['.page', '.main'] as const;

/**
 * Sends every relevant scroll container back to the top.
 *
 * Exported so the behaviour can be exercised without mounting a component; the
 * hook is a two-line wrapper around it.
 */
export function scrollPageToTop(): void {
  // Guarded so this is safe to call from anywhere, including a test harness
  // with a partial DOM.
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  window.scrollTo?.({ top: 0, left: 0, behavior: 'instant' });

  /* `scrollingElement` is `documentElement` in standards mode and `body` in
     quirks mode. Setting it directly also covers browsers where `scrollTo`
     with an options object is ignored. */
  const scroller = document.scrollingElement ?? document.documentElement;
  if (scroller && scroller.scrollTop !== 0) scroller.scrollTop = 0;

  for (const selector of WRAPPER_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);
    // Only touch one that is genuinely scrolled — reading is cheap, writing to
    // a non-scrollable element is a no-op but pointlessly invalidates layout.
    if (element && element.scrollTop > 0) element.scrollTop = 0;
  }
}

/**
 * Resets the scroll position whenever `key` changes.
 *
 * `key` is the current route. It is passed in rather than read from a router
 * because this app's router is a twenty-line hash router with no location
 * object — the route id *is* the location.
 *
 * The first render is skipped on purpose. There is nothing to reset on mount,
 * and forcing a scroll there would fight the browser's own scroll restoration
 * on reload — which is the browser's call to make, not this hook's.
 */
export function useScrollToTop(key: string): void {
  const previous = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (previous.current === null) {
      previous.current = key;
      return;
    }
    if (previous.current === key) return;

    previous.current = key;
    scrollPageToTop();
  }, [key]);
}
