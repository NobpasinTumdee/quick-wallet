import { ShieldCheck } from 'lucide-react';

import { LoginPage } from '../pages/LoginPage';
import { useAuth } from '../state/AuthContext';
import { AppShell } from './AppShell';
import { Icon } from './Icon';
import { Logo } from './Logo';

/**
 * The boot screen.
 *
 * This replaces the earlier "aurora" splash — drifting gradient blobs, scan
 * lines, expanding rings. That screen was technically cheap but read as a
 * product demo, and a demo is the wrong first impression for something holding
 * the user's money. Financial apps earn trust by looking *inevitable*: the mark,
 * a thin indeterminate line, one sentence, nothing else moving.
 *
 * Three deliberate choices:
 *
 *   - The progress line is indeterminate. There is no measurable progress
 *     during boot (a token check plus a cold Apps Script call), so a
 *     percentage would be a small lie told at the exact moment trust forms.
 *   - It follows the OS light/dark preference through the base tokens instead
 *     of forcing a dark canvas. SettingsProvider has not resolved the user's
 *     palette yet, and flashing dark before a light app is exactly the jolt
 *     this screen exists to avoid.
 *   - The footer states where the data lives. It is the one piece of
 *     information a user actually wants while waiting on a finance app.
 */
function BootScreen() {
  return (
    <div className="boot">
      <div className="boot-panel">
        <Logo size={52} className="boot-logo" />
        <div className="boot-wordmark">Quick Wallet</div>

        {/* aria-hidden: the live region below announces the state once, rather
            than letting a looping animation narrate itself. */}
        <div className="boot-progress" aria-hidden="true">
          <span />
        </div>

        <p className="boot-status">Securing connection…</p>
      </div>

      <div className="boot-foot">
        <Icon icon={ShieldCheck} size="sm" />
        Encrypted · Your data stays in your own Google Sheet
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        Securing connection, please wait.
      </span>
    </div>
  );
}

/**
 * Decides what the app is: booting, signed out, or signed in.
 *
 * Kept out of `App.tsx` so that file stays a provider stack and nothing else.
 */
export function Gate() {
  const { user, booting } = useAuth();

  if (booting) return <BootScreen />;

  return user ? <AppShell /> : <LoginPage />;
}
