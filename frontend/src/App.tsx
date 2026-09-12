import { Gate } from './components/Gate';
import { Toaster } from './components/Toaster';
import { AuthProvider } from './state/AuthContext';
import { SettingsProvider } from './state/SettingsContext';
import { ThemeProvider } from './state/ThemeContext';

export default function App() {
  return (
    <AuthProvider>
      {/* Settings live inside auth: they're scoped per user. */}
      <SettingsProvider>
        {/* Above the routed area so an unsaved theme draft keeps previewing
            while you walk the app looking at it — see state/ThemeContext.tsx. */}
        <ThemeProvider>
          {/* Booting / signed out / signed in — see components/Gate.tsx. */}
          <Gate />
          {/* Mounted once, outside the routed area, so a toast raised by an
              optimistic rollback survives the page it was triggered from. */}
          <Toaster />
        </ThemeProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
