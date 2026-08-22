import { AppShell } from './components/AppShell';
import { Logo } from './components/Logo';
import { Toaster } from './components/Toaster';
import { LoginPage } from './pages/LoginPage';
import { AuthProvider, useAuth } from './state/AuthContext';
import { SettingsProvider } from './state/SettingsContext';

/**
 * The boot screen.
 *
 * Every moving part animates `transform` or `opacity` only, so the whole scene
 * stays on the compositor and never triggers layout or paint. The aurora is
 * three large radial-gradient blobs drifting on their own prime-ish periods
 * (19s / 23s / 31s) — they never realign, so the loop has no visible seam.
 *
 * This screen deliberately does NOT follow the app theme. It renders before
 * SettingsProvider has resolved the user's palette, so there is no theme to
 * follow yet, and a splash is conventionally its own moment. The hues are
 * variables on `.boot`, so pointing them at --accent / --positive is a
 * three-line change if you want it themed later.
 */
function BootScreen() {
  return (
    <div className="boot">
      <div className="boot-aurora" aria-hidden="true">
        <span className="boot-blob boot-blob--emerald" />
        <span className="boot-blob boot-blob--cyan" />
        <span className="boot-blob boot-blob--amethyst" />
        <span className="boot-grid" />
        <span className="boot-vignette" />
      </div>

      <div className="boot-card">
        <div className="boot-mark">
          <span className="boot-halo" aria-hidden="true" />
          <span className="boot-ring" aria-hidden="true" />
          <span className="boot-ring boot-ring--delayed" aria-hidden="true" />
          <span className="boot-logo-clip">
            <Logo size={72} className="boot-logo" />
            <span className="boot-scan" aria-hidden="true" />
          </span>
        </div>

        <div className="boot-brand">Quick Wallet</div>

        {/* aria-live on the wrapper, not here: the dots would otherwise be
            announced as they animate. */}
        <p className="boot-status">
          Opening your workbook
          <span className="boot-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>

        <span className="boot-track" aria-hidden="true">
          <span className="boot-beam" />
        </span>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        Opening your workbook, please wait.
      </span>
    </div>
  );
}

function Gate() {
  const { user, booting } = useAuth();

  if (booting) return <BootScreen />;

  return user ? <AppShell /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      {/* Settings live inside auth: they're scoped per user. */}
      <SettingsProvider>
        <Gate />
        {/* Mounted once, outside the routed area, so a toast raised by an
            optimistic rollback survives the page it was triggered from. */}
        <Toaster />
      </SettingsProvider>
    </AuthProvider>
  );
}
