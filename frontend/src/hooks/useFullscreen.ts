import { useCallback, useEffect, useState } from 'react';

/**
 * Expand a panel to fill the screen.
 *
 * ---------------------------------------------------------------------------
 * TWO LAYERS, AND WHY BOTH
 * ---------------------------------------------------------------------------
 * The expansion itself is pure CSS — the panel becomes `position: fixed;
 * inset: 0`. That is what actually does the work, and it behaves identically
 * everywhere, including iOS Safari, which refuses `requestFullscreen()` on
 * anything that is not a `<video>`.
 *
 * On top of that, the real Fullscreen API is attempted as an enhancement, to
 * get rid of the browser's own chrome. If it is unavailable, blocked by a
 * permissions policy, or simply rejected, nothing breaks: the CSS layer has
 * already given the user what they asked for.
 *
 * ---------------------------------------------------------------------------
 * WHY IT FULLSCREENS THE DOCUMENT, NOT THE PANEL
 * ---------------------------------------------------------------------------
 * This one is a trap worth stating. When an element is put into fullscreen, the
 * browser renders *only that element's subtree*. Fullscreening the card itself
 * would therefore make every modal invisible — they are rendered as siblings at
 * the page root, so "Add to watchlist" would open a dialog nobody could see,
 * while still trapping focus and blocking the page.
 *
 * Fullscreening `document.documentElement` sidesteps it completely: everything
 * stays inside the fullscreen subtree, the CSS layer still positions the panel
 * over the viewport, and modals, toasts and the quick-add button all keep
 * working exactly as they do normally.
 */

/** Vendor-prefixed shapes still needed for Safari. */
interface FullscreenCapableElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface FullscreenCapableDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

function currentFullscreenElement(): Element | null {
  const doc = document as FullscreenCapableDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

async function enterNativeFullscreen(): Promise<void> {
  const root = document.documentElement as FullscreenCapableElement;
  const request = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);
  if (!request) return;
  try {
    await request();
  } catch {
    // Denied, unsupported, or not from a user gesture. The CSS layer stands.
  }
}

async function exitNativeFullscreen(): Promise<void> {
  if (!currentFullscreenElement()) return;
  const doc = document as FullscreenCapableDocument;
  const exit = doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc);
  if (!exit) return;
  try {
    await exit();
  } catch {
    /* Already out, or the browser refused. Nothing to recover. */
  }
}

export interface FullscreenState {
  expanded: boolean;
  expand: () => void;
  collapse: () => void;
  toggle: () => void;
}

export function useFullscreen(): FullscreenState {
  const [expanded, setExpanded] = useState(false);

  const expand = useCallback(() => {
    setExpanded(true);
    void enterNativeFullscreen();
  }, []);

  const collapse = useCallback(() => {
    setExpanded(false);
    void exitNativeFullscreen();
  }, []);

  const toggle = useCallback(() => {
    setExpanded((current) => {
      if (current) void exitNativeFullscreen();
      else void enterNativeFullscreen();
      return !current;
    });
  }, []);

  /* Escape collapses — but only when nothing is stacked on top.
     Modal listens on `document`, this listens on `window`, and bubbling reaches
     document first, so an open dialog always gets Escape before the panel
     behind it does. The explicit backdrop check is what actually guarantees it
     rather than relying on that ordering: closing the dialog you just opened is
     what Escape should do, not collapsing the panel underneath. */
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.modal-backdrop')) return;
      collapse();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, collapse]);

  /* The browser has its own ways out — Esc, F11, the address bar. When one of
     them fires, our state has to follow or the panel stays expanded with no
     visible way to close it. */
  useEffect(() => {
    if (!expanded) return undefined;
    const onChange = () => {
      if (!currentFullscreenElement()) setExpanded(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [expanded]);

  /* Stop the page behind from scrolling, the same way Modal does. */
  useEffect(() => {
    if (!expanded) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  /* Leaving the screen while expanded must not strand the browser in
     fullscreen with nothing on top of it. */
  useEffect(
    () => () => {
      void exitNativeFullscreen();
      document.body.style.overflow = '';
    },
    [],
  );

  return { expanded, expand, collapse, toggle };
}
