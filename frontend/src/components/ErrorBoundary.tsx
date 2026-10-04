import { Component, ErrorInfo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { canAttemptReload } from '../lib/lazyWithRetry';

/**
 * Catches what nothing else can.
 *
 * ---------------------------------------------------------------------------
 * WHY A CLASS, IN 2026
 * ---------------------------------------------------------------------------
 * There is still no hook for this. `getDerivedStateFromError` and
 * `componentDidCatch` are class-only, and a render error that reaches the root
 * unmounts the entire tree — the blank white screen. This is the only
 * construct React offers to stop that.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS REALLY FOR HERE
 * ---------------------------------------------------------------------------
 * The stale-chunk path in `lazyWithRetry` already reloads once on its own. By
 * the time an error arrives here, that recovery has been tried and did not
 * work — so the honest thing is to stop reloading and hand the decision over,
 * rather than put the tab in a loop the user cannot escape.
 *
 * The distinction the fallback draws is therefore not cosmetic. A chunk error
 * means *the app is out of date* and refreshing genuinely fixes it. Any other
 * error means something is actually wrong, and promising a refresh will fix it
 * would be a lie that costs the user their unsaved work to discover.
 */
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /* Kept to the console rather than sent anywhere: this app has no error
       reporting service, and inventing one here would be a privacy decision
       made in a component. The stack is what a developer needs when a user
       sends a screenshot of the fallback. */
    console.error('[quick-wallet] render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <ErrorFallback error={this.state.error} onRetry={() => this.setState({ error: null })} />;
  }
}

/**
 * Does this error mean "the app is out of date" rather than "something broke"?
 *
 * Matched on the message because that is all the platform gives us: a failed
 * dynamic import surfaces as a plain `TypeError`, with no code or type to key
 * on, and the wording differs across engines. Chrome says "Failed to fetch
 * dynamically imported module", Firefox "error loading dynamically imported
 * module", Safari "Importing a module script failed", and the MIME complaint
 * is the catch-all redirect answering with `index.html`.
 *
 * A miss here is not costly: the fallback simply shows the general message
 * instead of the update one, and the refresh button is on both.
 */
function isStaleChunkError(error: Error): boolean {
  const text = `${error.name} ${error.message}`.toLowerCase();
  return (
    text.includes('dynamically imported module') ||
    text.includes('importing a module script failed') ||
    text.includes('failed to fetch dynamically') ||
    (text.includes('mime type') && text.includes('text/html')) ||
    text.includes('chunkloaderror')
  );
}

function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useTranslation();
  const stale = isStaleChunkError(error);

  /* If the automatic reload is still on cooldown, saying "Refresh" would be
     offering a button we know is about to be swallowed. Better to say so. */
  const reloadUseful = canAttemptReload();

  return (
    <div className="app-error" role="alert">
      <div className="app-error-card">
        <span className={cxTone(stale)} aria-hidden="true">
          <Icon icon={stale ? RefreshCw : TriangleAlert} />
        </span>

        <h1 className="app-error-title">{t(stale ? 'errors.newVersionTitle' : 'errors.crashTitle')}</h1>
        <p className="app-error-text">{t(stale ? 'errors.newVersionBody' : 'errors.crashBody')}</p>

        <div className="app-error-actions">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            <Icon icon={RefreshCw} size="sm" />
            {t('errors.refresh')}
          </button>

          {/* A second chance without losing the tab. Re-rendering the subtree
              is free, and for a one-off error — a transient fetch, a race on
              unmount — it is the cheaper fix. Hidden when a reload is the
              only thing that can work. */}
          {!stale && (
            <button type="button" className="btn btn-ghost" onClick={onRetry}>
              {t('errors.tryAgain')}
            </button>
          )}
        </div>

        {!reloadUseful && <p className="app-error-hint">{t('errors.reloadLoopHint')}</p>}

        {/* The message itself, small and selectable. Someone reporting this
            needs something to paste, and a fallback that hides the error makes
            every report "it just went blank". */}
        <p className="app-error-detail">{error.message}</p>
      </div>
    </div>
  );
}

function cxTone(stale: boolean): string {
  return stale ? 'app-error-mark is-update' : 'app-error-mark is-fault';
}
