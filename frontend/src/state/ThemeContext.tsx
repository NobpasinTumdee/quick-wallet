import { ReactNode, createContext, useContext } from 'react';

import { ThemeEngine, useThemeEngine } from '../hooks/useTheme';

/**
 * Mounts the theme engine once, at the root.
 *
 * It is app-level rather than Settings-level on purpose: an open draft paints
 * the *whole* app, and a theme is judged on the dashboard rather than on the
 * form that made it. Navigating away from Settings therefore keeps the preview
 * up, and coming back finds the creator exactly as it was left.
 *
 * All the logic is in `hooks/useTheme.ts`; this file only carries the JSX the
 * provider needs.
 */

const ThemeContext = createContext<ThemeEngine | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const engine = useThemeEngine();
  return <ThemeContext.Provider value={engine}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeEngine {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
