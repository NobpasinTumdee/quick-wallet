import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import { formatMoney } from '../lib/format';
import { Settings, ThemeName } from '../types';
import { useAuth } from './AuthContext';

/**
 * Holds the signed-in user's Settings row and applies it to the DOM:
 * `data-theme` picks a palette from theme.css, and `--accent` / custom vars are
 * written as inline custom properties on <html>.
 */

export const DEFAULT_SETTINGS: Settings = {
  userId: '',
  theme: 'dark',
  accent: '#4f8cff',
  customVars: {},
  currency: 'USD',
  displayCurrency: '',
  fxRate: 1,
  fxRateUpdatedAt: '',
  locale: 'en-US',
  monthlyIncome: 0,
  categories: [],
  updatedAt: '',
};

interface SettingsContextValue {
  settings: Settings;
  loading: boolean;
  error: string | null;
  save: (patch: Partial<Settings>) => Promise<void>;
  setTheme: (theme: ThemeName) => Promise<void>;
  reload: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function applyToDocument(settings: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;

  // Custom vars first, then accent, so an explicit accent always wins.
  root.style.cssText = '';
  if (settings.theme === 'custom') {
    for (const [key, value] of Object.entries(settings.customVars ?? {})) {
      if (key.startsWith('--')) root.style.setProperty(key, value);
    }
  }
  if (settings.accent) root.style.setProperty('--accent', settings.accent);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const next = await api.get<Settings>('/api/settings');
      setSettings(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSettings(DEFAULT_SETTINGS);
      return;
    }
    void reload();
  }, [user, reload]);

  useEffect(() => {
    applyToDocument(settings);
  }, [settings]);

  const save = useCallback(
    async (patch: Partial<Settings>) => {
      // Optimistic: theme changes should feel instant, and a failed write only
      // means the workbook is briefly out of sync with the screen.
      const previous = settings;
      const optimistic = { ...settings, ...patch };
      setSettings(optimistic);
      try {
        const saved = await api.put<Settings>('/api/settings', patch);
        setSettings(saved);
        setError(null);
      } catch (err) {
        setSettings(previous);
        setError(err instanceof Error ? err.message : 'Could not save settings');
        throw err;
      }
    },
    [settings],
  );

  const setTheme = useCallback((theme: ThemeName) => save({ theme }), [save]);

  const value = useMemo(
    () => ({ settings, loading, error, save, setTheme, reload }),
    [settings, loading, error, save, setTheme, reload],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside <SettingsProvider>');
  return context;
}

export interface MoneyFormatter {
  (value: number, options?: { compact?: boolean; signed?: boolean }): string;
  /** Base amount → display amount. */
  convert: (value: number) => number;
  /** Currency amounts are stored in. */
  base: string;
  /** Currency amounts are shown in. */
  display: string;
  rate: number;
  /** True when display differs from base, i.e. numbers on screen are converted. */
  converting: boolean;
  /** Format without converting — for labelling an input that takes base currency. */
  formatBase: (value: number, options?: { compact?: boolean; signed?: boolean }) => string;
}

/**
 * The money formatter every screen should use.
 *
 * Amounts are *stored* in `settings.currency` and only converted for display,
 * so switching the display currency never rewrites the workbook and switching
 * back is lossless.
 */
export function useMoneyFormatter(): MoneyFormatter {
  const { settings } = useSettings();

  return useMemo(() => {
    const base = settings.currency || 'USD';
    const display = settings.displayCurrency || base;
    const converting = display !== base;
    const rate = converting && settings.fxRate > 0 ? settings.fxRate : 1;

    const format = ((value, options) =>
      formatMoney(value * rate, display, settings.locale, options)) as MoneyFormatter;

    format.convert = (value: number) => value * rate;
    format.base = base;
    format.display = display;
    format.rate = rate;
    format.converting = converting;
    format.formatBase = (value, options) => formatMoney(value, base, settings.locale, options);

    return format;
  }, [settings.currency, settings.displayCurrency, settings.fxRate, settings.locale]);
}
