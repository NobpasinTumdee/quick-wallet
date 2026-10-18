/**
 * The one record of which overlays are open, in order.
 *
 * ---------------------------------------------------------------------------
 * WHY A STACK
 * ---------------------------------------------------------------------------
 * A confirm dialog opened from a sheet is two overlays at once. Without a
 * shared record each one listens for Escape on its own, so one key press
 * closed both; each one locked the body scroll and restored "whatever it was
 * before", so closing them out of order left the page locked; and Back on a
 * phone left the app instead of closing the top sheet.
 *
 * So every overlay registers here on open and leaves on close, and:
 *   - only the top entry reacts to Escape and to Back
 *   - the page scroll is locked while the stack is non-empty, once
 *   - each entry gets a depth, which becomes its z-index step
 *   - the visual viewport (on-screen keyboard) is tracked while anything is
 *     open and exposed as CSS variables
 *
 * ---------------------------------------------------------------------------
 * BACK ON A PHONE
 * ---------------------------------------------------------------------------
 * Opening an overlay on a touch-sized screen pushes one history entry with
 * the *same* URL, so the hash router sees nothing. Back pops it and closes the
 * top overlay. Closing it any other way (✕, backdrop, Escape, success) calls
 * `history.back()` to remove the entry it pushed, and the resulting popstate
 * is ignored. Desktop never pushes, so its history is exactly as before.
 */

interface Entry {
  id: number;
  close: () => void;
  /** Whether this entry pushed a history state that must be popped. */
  pushedHistory: boolean;
}

const stack: Entry[] = [];
let nextId = 1;
/** popstate events we caused ourselves and must not treat as Back. */
let selfPops = 0;

const MOBILE_QUERY = '(max-width: 767px)';

function isMobile(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_QUERY).matches
    : false;
}

/* ---- Scroll lock ---- */

let savedScrollY = 0;

function lockScroll(): void {
  const root = document.documentElement;
  savedScrollY = window.scrollY;
  root.classList.add('has-overlay');
  /* `overflow: hidden` on both: iOS ignores it on <body> alone, and the
     scrollbar gutter is kept so the page does not jump sideways on desktop. */
  root.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}

function unlockScroll(): void {
  const root = document.documentElement;
  root.classList.remove('has-overlay');
  root.style.overflow = '';
  document.body.style.overflow = '';
  /* iOS can nudge the page while the keyboard was up; put it back. */
  if (Math.abs(window.scrollY - savedScrollY) > 1) window.scrollTo(0, savedScrollY);
}

/* ---- The on-screen keyboard ---- */

function syncViewport(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) return;
  /* How much of the layout viewport's bottom is hidden — by the keyboard on
     iOS, where the layout viewport does not shrink when it opens. */
  const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
  root.style.setProperty('--kb-inset', `${Math.round(hidden)}px`);
}

function clearViewport(): void {
  const root = document.documentElement;
  root.style.removeProperty('--vv-height');
  root.style.removeProperty('--kb-inset');
}

/* ---- History ----
   The popstate listener is installed once and never removed. It used to come
   and go with the stack, which meant the popstate caused by closing the last
   overlay arrived after the listener was gone: `selfPops` was never paid back,
   and the user's *next* real Back was swallowed.

   Pops are also deferred. Closing a sheet and opening the next one in the
   same tick — the "⋯" menu handing over to Edit, or StrictMode's mount,
   unmount, mount — used to call `history.back()` and then `pushState()`.
   Chrome resolves the back against the entry list as it was when back() was
   called, so it removed two entries, and the following close walked out of
   the app. Now a released entry is handed to an overlay pushed before the
   pop runs, and only what is left over is popped, in one `go(-n)`. */

/** Released entries whose history state has not been popped yet. */
let pendingPops = 0;
let flushTimer: number | undefined;

function flushPops(): void {
  flushTimer = undefined;
  if (pendingPops === 0) return;
  const n = pendingPops;
  pendingPops = 0;
  /* One traversal, so exactly one popstate to ignore. */
  selfPops += 1;
  window.history.go(-n);
}

function schedulePops(): void {
  if (flushTimer === undefined) flushTimer = window.setTimeout(flushPops, 0);
}

function onPopState(): void {
  if (selfPops > 0) {
    selfPops -= 1;
    return;
  }
  const top = stack[stack.length - 1];
  if (top && top.pushedHistory) {
    /* The browser already removed the entry; the close must not pop again. */
    top.pushedHistory = false;
    top.close();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', onPopState);
}

/* ---- Listeners, attached while anything is open ---- */

function attach(): void {
  lockScroll();
  syncViewport();
  window.visualViewport?.addEventListener('resize', syncViewport);
  window.visualViewport?.addEventListener('scroll', syncViewport);
}

function detach(): void {
  unlockScroll();
  clearViewport();
  window.visualViewport?.removeEventListener('resize', syncViewport);
  window.visualViewport?.removeEventListener('scroll', syncViewport);
}

/* ---- Public ---- */

export interface OverlayHandle {
  id: number;
  /** 0 for the first overlay, 1 for one opened from it, … */
  depth: number;
  isTop: () => boolean;
  release: () => void;
}

export function pushOverlay(close: () => void): OverlayHandle {
  const id = nextId++;
  const wantsHistory = isMobile();
  if (stack.length === 0) attach();
  const entry: Entry = { id, close, pushedHistory: false };
  stack.push(entry);

  if (wantsHistory) {
    if (pendingPops > 0) {
      /* Take over the entry a just-closed overlay left behind. */
      pendingPops -= 1;
      entry.pushedHistory = true;
    } else {
      try {
        window.history.pushState({ ...(window.history.state ?? {}), qwOverlay: id }, '');
        entry.pushedHistory = true;
      } catch {
        /* Some embedded browsers refuse; Back simply will not close it. */
      }
    }
  }

  return {
    id,
    depth: stack.length - 1,
    isTop: () => stack[stack.length - 1]?.id === id,
    release: () => {
      const index = stack.findIndex((item) => item.id === id);
      if (index === -1) return;
      const [removed] = stack.splice(index, 1);
      if (removed.pushedHistory) {
        pendingPops += 1;
        schedulePops();
      }
      if (stack.length === 0) detach();
    },
  };
}

/** Lets the current close handler be swapped without re-registering. */
export function updateOverlayClose(id: number, close: () => void): void {
  const entry = stack.find((item) => item.id === id);
  if (entry) entry.close = close;
}

export function overlayCount(): number {
  return stack.length;
}
