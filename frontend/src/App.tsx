import { Gate } from './components/Gate';
import { Toaster } from './components/Toaster';
import { AuthProvider } from './state/AuthContext';
import { SettingsProvider } from './state/SettingsContext';

export default function App() {
  return (
    <AuthProvider>
      {/* Settings live inside auth: they're scoped per user. */}
      <SettingsProvider>
        {/* Booting / signed out / signed in — see components/Gate.tsx. */}
        <Gate />
        {/* Mounted once, outside the routed area, so a toast raised by an
            optimistic rollback survives the page it was triggered from. */}
        <Toaster />
      </SettingsProvider>
    </AuthProvider>
  );
}
