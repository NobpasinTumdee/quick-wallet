import { FormEvent, useEffect, useState } from 'react';

import { api } from '../api/client';
import { Logo } from '../components/Logo';
import { Alert, Button, Field, Input } from '../components/ui';
import { useAuth } from '../state/AuthContext';

interface UserListResponse {
  users: { id: string; username: string; displayName: string }[];
  needsSetup: boolean;
}

export function LoginPage() {
  const { login, register } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [knownUsers, setKnownUsers] = useState<UserListResponse['users']>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // An empty workbook means first run — go straight to the register form.
  useEffect(() => {
    let cancelled = false;
    api
      .get<UserListResponse>('/api/auth/users')
      .then((data) => {
        if (cancelled) return;
        setKnownUsers(data.users);
        if (data.needsSetup) setMode('register');
        else if (data.users.length === 1) setUsername(data.users[0].username);
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

  const isFirstRun = knownUsers.length === 0;

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <Logo size={72} className="auth-logo" /> Quick Wallet
        </div>
        <p className="auth-sub">
          {mode === 'login'
            ? 'Everything stays in database.xlsx on this machine.'
            : isFirstRun
              ? 'Create the first profile for this workbook.'
              : 'Add another profile to this workbook.'}
        </p>

        {mode === 'login' && knownUsers.length > 0 && (
          <div className="user-chips">
            {knownUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                className={`user-chip${username === user.username ? ' is-active' : ''}`}
                onClick={() => setUsername(user.username)}
              >
                {user.displayName}
              </button>
            ))}
          </div>
        )}

        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <Field label="Username">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
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

        {!isFirstRun && (
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
