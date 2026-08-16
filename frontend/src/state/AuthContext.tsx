import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { clearCache } from '../api/cache';
import { api, getToken, onUnauthorized, setToken } from '../api/client';
import { PublicUser } from '../types';

interface AuthResponse {
  token: string;
  user: PublicUser;
}

interface AuthContextValue {
  user: PublicUser | null;
  /** True while we validate a stored token on boot. */
  booting: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [booting, setBooting] = useState(true);

  // Resume the previous session if the stored token is still valid.
  useEffect(() => {
    let cancelled = false;

    async function restore(): Promise<void> {
      if (!getToken()) {
        setBooting(false);
        return;
      }
      try {
        const { user: me } = await api.get<{ user: PublicUser }>('/api/auth/me');
        if (!cancelled) setUser(me);
      } catch {
        // Expired token or backend down — the login screen explains either way.
        setToken(null);
      } finally {
        if (!cancelled) setBooting(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 anywhere in the app drops us back to the login screen.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.post<AuthResponse>('/api/auth/login', { username, password });
    setToken(result.token);
    setUser(result.user);
  }, []);

  const register = useCallback(async (username: string, password: string, displayName: string) => {
    const result = await api.post<AuthResponse>('/api/auth/register', {
      username,
      password,
      displayName,
    });
    setToken(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    // Cached rows are scoped to the signed-in user — never let the next one
    // see them flash on screen before their own data arrives.
    clearCache();
  }, []);

  const value = useMemo(
    () => ({ user, booting, login, register, logout }),
    [user, booting, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
