import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { useCurrentUser } from './data/useCurrentUser';
import { DOMAIN } from './domain';
import { canAdmin } from './lib/capabilities';
import { HomeView } from './views/HomeView';
import { UsersView } from './views/UsersView';
import { RolesView } from './views/RolesView';
import { ApiKeysView } from './views/ApiKeysView';
import { GleanView } from './views/GleanView';
import { GleanCallbackView } from './views/GleanCallbackView';
import { LoginActivityView } from './views/LoginActivityView';
import { AwsView } from './views/AwsView';

// Routes: the platform's plus the domain's (src/domain.tsx). The admin section
// is gated client-side on `me.isAdmin` for navigation; every resolver behind
// it enforces requireAdmin on the server.
export function App() {
  const me = useCurrentUser();
  const admin = canAdmin(me);
  const gate = (el: React.ReactElement) => (admin ? el : <Navigate to="/" replace />);
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomeView />} />
        {DOMAIN.routes.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
        <Route path="/users" element={<UsersView />} />
        <Route path="/admin" element={<Navigate to="/admin/roles" replace />} />
        <Route path="/admin/roles" element={gate(<RolesView />)} />
        <Route path="/admin/api-keys" element={gate(<ApiKeysView />)} />
        <Route path="/admin/glean" element={gate(<GleanView />)} />
        <Route path="/admin/login-activity" element={gate(<LoginActivityView />)} />
        <Route path="/admin/aws" element={gate(<AwsView />)} />
        <Route path="/glean/callback" element={<GleanCallbackView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
