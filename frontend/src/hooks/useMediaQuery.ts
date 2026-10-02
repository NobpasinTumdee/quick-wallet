import { useSyncExternalStore } from 'react';

/**
 * Does the viewport match this media query, right now?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS WHEN CSS CAN ALREADY SWITCH LAYOUTS
 * ---------------------------------------------------------------------------
 * For most responsive work it should not: a media query in the stylesheet is
 * cheaper, has no JavaScript to run and cannot flicker. This is for the case
 * where the two layouts are *different DOM*, and the hidden one would still be
 * built.
 *
 * The Activity list is exactly that case. It renders every transaction the
 * filters allow, up to the 5,000 the server will return, and `display: none`
 * does not stop React creating those nodes — it only stops the browser
 * painting them. Rendering a table and a tile list together would mean ten
 * thousand rows in the tree to show five thousand, on the screen most likely
 * to be a phone.
 *
 * ---------------------------------------------------------------------------
 * WHY `useSyncExternalStore`
 * ---------------------------------------------------------------------------
 * `matchMedia` is an external store with a subscribe method and a snapshot,
 * which is precisely what this hook is for. The alternative — `useState` plus
 * an effect — reads the query *after* the first paint, so the wrong layout
 * renders for one frame on every load. This reads it during render.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      /* Guarded for environments without matchMedia — the test harness runs
         these components under a stubbed DOM. */
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => {
      if (typeof window === 'undefined' || !window.matchMedia) return false;
      return window.matchMedia(query).matches;
    },
    /* Server snapshot: there is no server render here, but React asks for it
       and a lie would be worse than "assume the smaller layout". */
    () => false,
  );
}

/**
 * The one breakpoint the app switches *structure* at.
 *
 * Kept beside the hook, and deliberately the same 768px the stylesheet uses
 * for the same decision — two numbers that must agree should be one constant.
 */
export const DESKTOP_QUERY = '(min-width: 768px)';
