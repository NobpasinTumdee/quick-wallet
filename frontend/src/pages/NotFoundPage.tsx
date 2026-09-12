import { Compass, LayoutDashboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { Route, currentHashPath } from '../lib/router';

/**
 * The catch-all screen.
 *
 * Reached when the hash names a route that does not exist. The router used to
 * fall back to the dashboard here, which meant a renamed or mistyped link
 * quietly showed today's balances instead — indistinguishable from the link
 * having worked, and the user never learns the page they wanted is gone.
 *
 * It quotes the path back. A 404 that does not say what it could not find makes
 * the reader guess whether they mistyped, whether the app is broken, or whether
 * the page moved; the string they asked for usually answers that on sight.
 */
export function NotFoundPage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { t } = useTranslation();

  return (
    <div className="notfound">
      <div className="notfound-card">
        <span className="notfound-mark" aria-hidden="true">
          <Icon icon={Compass} size="xl" />
        </span>

        <h1 className="notfound-title">{t('notFound.title')}</h1>
        <p className="notfound-message">{t('notFound.message')}</p>

        <code className="notfound-path">{t('notFound.attempted', { path: currentHashPath() })}</code>

        <Button variant="primary" onClick={() => onNavigate('dashboard')}>
          <Icon icon={LayoutDashboard} size="sm" />
          {t('notFound.goHome')}
        </Button>
      </div>
    </div>
  );
}
