import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { AuthProvider, useAuth } from './state/AuthContext';
import { SettingsProvider } from './state/SettingsContext';

function Gate() {
  const { user, booting } = useAuth();

  if (booting) {
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="auth-brand">
            <span aria-hidden="true">💰</span> Quick Wallet
          </div>
          <p className="auth-sub">Opening your workbook…</p>
        </div>
      </div>
    );
  }

  return user ? <AppShell /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      {/* Settings live inside auth: they're scoped per user. */}
      <SettingsProvider>
        <Gate />
      </SettingsProvider>
    </AuthProvider>
  );
}
