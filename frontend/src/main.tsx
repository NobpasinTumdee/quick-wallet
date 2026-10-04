import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { markStaleBuild, reloadForNewBuild } from './lib/lazyWithRetry';
/* Side-effect import, and it has to be above App: `useTranslation` throws if no
   i18next instance is initialised, so the instance must exist before the first
   render rather than being created inside a component. */
import './lib/i18n';
import './styles/theme.css';
import './styles/app.css';

/**
 * Vite's own signal that a chunk could not be preloaded.
 *
 * It fires earlier than the failed `import()` — on the `<link modulepreload>`
 * the router emits — so handling it here turns a recovery that would have
 * waited for the user to finish navigating into one that happens immediately.
 *
 * `preventDefault` stops Vite's default behaviour of rethrowing the error as
 * an unhandled rejection. We are handling it; an uncaught error in the console
 * on top of that is noise, not information.
 */
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  /* Tells the lazy wrapper to skip its retry: Vite has already established the
     file is not there, so asking a second time only delays the reload. */
  markStaleBuild();
  reloadForNewBuild();
});

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    {/* Outside every provider: a crash in one of them — a bad stored theme, a
        malformed settings row — would otherwise take the tree down with
        nothing left to render the error with. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
