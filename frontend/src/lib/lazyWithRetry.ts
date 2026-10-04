import { ComponentType, lazy } from 'react';

/**
 * `React.lazy`, but it survives a deploy.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * Vite fingerprints every chunk: `DeepAnalyticsPage-C7x9k2.js`. The filename
 * is baked into the `index.html` that served the running tab. Deploy again and
 * the hashes change; the host keeps only the new files.
 *
 * A tab left open overnight is now holding a map to files that no longer
 * exist. Open a lazy route and the browser asks for the old chunk, and here is
 * the part that turns a 404 into something confusing: `public/_redirects` ends
 * with `/* /index.html 200`, the SPA catch-all every client-routed app needs.
 * So the missing chunk does not 404 — it matches the catch-all and the server
 * cheerfully returns `index.html`, with `Content-Type: text/html`.
 *
 * The module loader asked for JavaScript and was handed a web page, which is
 * the error people actually see:
 *
 *     TypeError: Failed to fetch dynamically imported module …
 *     Expected a JavaScript module script but the server responded with a
 *     MIME type of "text/html"
 *
 * Nothing is broken. The app is simply one version behind, and the only way
 * out is to re-fetch `index.html` and learn the new filenames — a reload.
 *
 * ---------------------------------------------------------------------------
 * WHY A RETRY *AND* A RELOAD
 * ---------------------------------------------------------------------------
 * Two different faults produce the same rejection. A flaky connection drops
 * one request and the very same URL works a moment later; a stale deploy means
 * that URL is gone for good and retrying it is pure delay. One cheap retry
 * covers the first without meaningfully slowing the second.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RELOAD IS GUARDED
 * ---------------------------------------------------------------------------
 * If the chunk is missing for some reason a reload cannot fix — a broken
 * deploy, a misconfigured host, an offline device — then "reload on failure"
 * is an infinite loop, and the user is trapped in a flickering tab with no
 * error to report. The flag in `sessionStorage` means we attempt the reload
 * *once*; the second failure is allowed to reach the error boundary, which can
 * at least say what happened and offer the button manually.
 *
 * `sessionStorage`, not `localStorage`: the flag should die with the tab.
 */

/** One key per app, holding the timestamp of the last recovery reload. */
const RELOAD_KEY = 'quick-wallet.chunk-reload-at';

/**
 * How long a recovery reload counts as "just happened".
 *
 * Long enough that a reload which failed to fix anything will not immediately
 * reload again, short enough that the *next* deploy — hours later, same tab —
 * gets its own automatic recovery rather than being told to refresh by hand.
 */
const RELOAD_COOLDOWN_MS = 15_000;

/**
 * Set by the `vite:preloadError` listener in `main.tsx`.
 *
 * When Vite has already told us a chunk could not be preloaded, we know the
 * build is stale and the retry below is certain to fail. Skipping it means the
 * reload happens immediately rather than after a wasted round trip.
 */
let staleBuildDetected = false;

export function markStaleBuild(): void {
  staleBuildDetected = true;
}

/** Storage can throw — private mode, blocked site data — and never fatally. */
function lastReloadAt(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    /* Unreadable storage means we cannot prove a reload already happened. We
       assume it did not and allow one: a single extra reload is a far better
       failure than a blank screen nobody can get out of. */
    return 0;
  }
}

/**
 * Records that a recovery reload is happening. Returns false if it could not.
 *
 * The return value is load-bearing, and was the bug this file was written to
 * avoid: if the write throws — private mode, blocked site data — then nothing
 * remembers that a reload already happened, and "reload whenever a chunk
 * fails" becomes a tab that reloads forever. A caller that reloads without a
 * recorded guard has no way to ever stop.
 */
function rememberReload(): boolean {
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/**
 * True if a recovery reload is allowed right now.
 *
 * Exported for the preload handler, which needs the same answer.
 */
export function canAttemptReload(): boolean {
  const last = lastReloadAt();
  if (last === 0) return true;
  return Date.now() - last > RELOAD_COOLDOWN_MS;
}

/** The reload itself, guarded. Returns false when it declined to act. */
export function reloadForNewBuild(): boolean {
  if (!canAttemptReload()) return false;
  /* No guard, no reload. Without somewhere to record this attempt the loop is
     unbounded, and a single error screen is a far better outcome than a tab
     that reloads until it is closed. */
  if (!rememberReload()) return false;
  /* `location.reload()` and not `location.href = location.href`: the second
     does nothing at all when the URL carries a hash, and this app routes
     entirely on the hash. */
  window.location.reload();
  return true;
}

/**
 * Wraps a dynamic import so a stale chunk recovers instead of white-screening.
 *
 * Drop-in for `React.lazy` — same signature, same return type — so a call site
 * changes by one word.
 */
/* `ComponentType<any>` mirrors React's own `lazy` signature exactly, and has
   to: `ComponentType<unknown>` refuses every component that takes props,
   because props are contravariant. Narrowing it here would make the wrapper
   unusable on all but one of the eight call sites. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error) {
      /* A second attempt, unless Vite has already told us the build is stale
         and the URL is certainly gone. */
      if (!staleBuildDetected) {
        try {
          return await factory();
        } catch {
          /* Fall through to the reload. */
        }
      }

      if (reloadForNewBuild()) {
        /* The tab is now navigating away. Nothing should render in the frames
           before it goes, and resolving with a component would paint one, so
           this promise is left to hang deliberately. React keeps the Suspense
           fallback on screen, which is the right thing to look at while a
           reload is in flight. */
        return await new Promise<{ default: T }>(() => undefined);
      }

      /* We already tried a reload and it did not help, so this is not a stale
         deploy — it is a real failure. Let it reach the error boundary, which
         can explain it and offer the choice rather than looping. */
      throw error;
    }
  });
}
