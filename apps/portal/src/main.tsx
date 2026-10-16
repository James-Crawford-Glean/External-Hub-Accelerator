import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AppAuthProvider, AuthGate } from './lib/auth/AuthProvider';
import { CONFIGURED } from './lib/api/config';
import { initTelemetry, recordPage } from './lib/telemetry';
import { ToastRoot } from './components/ui/Toast';
import { EmptyState } from './components/ui/EmptyState';
import './styles/global.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/views.css';

// Start RUM as early as possible so page load and web vitals are captured.
// No-op unless an app monitor is configured.
initTelemetry();
recordPage(window.location.pathname);

const root = createRoot(document.getElementById('root')!);

if (!CONFIGURED) {
  root.render(
    <StrictMode>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <EmptyState
          title="Portal is not configured"
          body="Set VITE_GRAPHQL_URL, VITE_COGNITO_AUTHORITY, and VITE_COGNITO_CLIENT_ID (see .env.example) and rebuild."
        />
      </div>
    </StrictMode>,
  );
} else {
  // The router mounts under the deploy base (/<app>/ in production, / in dev) so
  // deep links and reloads resolve to the served path.
  root.render(
    <StrictMode>
      <AppAuthProvider>
        <AuthGate>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <App />
            <ToastRoot />
          </BrowserRouter>
        </AuthGate>
      </AppAuthProvider>
    </StrictMode>,
  );
}
