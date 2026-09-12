import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // No dev proxy any more: the frontend talks straight to the Google Apps
    // Script Web App (VITE_GAS_WEB_APP_URL). Requests are shaped as "simple"
    // CORS requests so no preflight is needed — see src/api/client.ts.
  },
});
