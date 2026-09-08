import { FormEvent, useEffect, useState } from 'react';

import { api } from '../api/client';
import { Logo } from '../components/Logo';
import { Alert, Button, Field, Input } from '../components/ui';
import { useAuth } from '../state/AuthContext';

/**
 * Sign in.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO LIST OF PROFILES
 * ---------------------------------------------------------------------------
 * There used to be. This screen fetched every registered user and rendered them
 * as clickable chips, which made signing in one tap faster and handed anyone who
 * opened the page the display name of every person who banks in this workbook —
 * plus, since the chips filled in the username field, half of every credential
 * pair. On a shared machine that is a stranger learning who else uses it; on a
 * deployed URL it is account enumeration.
 *
 * The screen now asks who you are and takes your word for nothing. The only
 * thing it still fetches before sign-in is a single boolean — whether the
 * workbook has any profile at all — because it has to know whether to offer
 * "sign in" or "create the first profile". That is served by `auth.status`,
 * which was rewritten to return nothing but that bit; deleting the chips alone
 * would have left the endpoint answering the same question to anyone who
 * called it directly.
 */

interface AuthStatusResponse {
  needsSetup: boolean;
}

export function LoginPage() {
  const { login, register } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  /** Null until the status check answers — drives the copy, nothing else. */
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // An empty workbook means first run — go straight to the register form.
  useEffect(() => {
    let cancelled = false;
    api
      .get<AuthStatusResponse>('/api/auth/status')
      .then((data) => {
        if (cancelled) return;
        setNeedsSetup(data.needsSetup);
        if (data.needsSetup) setMode('register');
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(username.trim(), password);
      else await register(username.trim(), password, displayName.trim() || username.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  const isFirstRun = needsSetup === true;

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <Logo size={72} className="auth-logo" /> Quick Wallet
        </div>
        <p className="auth-sub">
          {mode === 'login'
            ? 'Sign in to your workbook.'
            : isFirstRun
              ? 'Create the first profile for this workbook.'
              : 'Add another profile to this workbook.'}
        </p>

        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <Field label="Username">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              /* Nothing is pre-filled and nothing is suggested by the app. The
                 browser's own password manager may still offer a saved entry,
                 which is the right place for that to come from. */
              required
              autoFocus
            />
          </Field>

          {mode === 'register' && (
            <Field label="Display name" hint="Shown in the sidebar. Defaults to your username.">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
          )}

          <Field label="Password" hint={mode === 'register' ? 'At least 4 characters.' : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </Field>

          {error && <Alert tone="error">{error}</Alert>}

          <Button type="submit" variant="primary" loading={busy}>
            {mode === 'login' ? 'Sign in' : 'Create profile'}
          </Button>
        </div>

        {/* Hidden until the status check answers. Offering "create profile" on a
            workbook that turns out to need setup, or vice versa, is a worse
            first impression than a beat of nothing. */}
        {needsSetup === false && (
          <p className="auth-switch">
            {mode === 'login' ? 'Need another profile?' : 'Already have one?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
              }}
            >
              {mode === 'login' ? 'Create profile' : 'Sign in'}
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
