// @vitest-environment jsdom
// Renders the shell and every platform route with the API layer mocked and an
// empty domain registration. Proves the shell composes against the platform
// schema alone, which is what an adopter starts from after deleting the
// example domain. The example's own routes are covered in items.dom.test.tsx.
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { CurrentUserContext } from '../data/useCurrentUser';
import type { User } from '../data/types';

const me: User = {
  id: 'usr_00000000000001',
  name: 'Ada Admin',
  email: 'ada@example.com',
  title: 'Operations',
  role: 'ADMINISTRATOR',
  isAdmin: true,
  isActive: true,
  initials: 'AA',
  avatarUrl: null,
};

vi.mock('../domain', async () => ({ DOMAIN: (await import('../lib/domain')).EMPTY_DOMAIN }));
vi.mock('../lib/api/identity', () => ({
  fetchMe: async () => me,
  recordLogin: async () => undefined,
  fetchUsers: async () => ({ items: [me], total: 1 }),
  fetchAccessRoster: async () => [{ email: 'ada@example.com', name: 'Ada Admin', role: 'ADMINISTRATOR', isAdmin: true }],
  fetchAccessRequests: async () => [{ email: 'new@example.com', name: 'Nia New', attempts: 2, firstSeen: '2026-10-15T10:00:00Z', lastSeen: '2026-10-16T02:00:00Z' }],
  updateRosterMember: async () => ({ email: 'x', name: null, role: 'VIEWER', isAdmin: false }),
  removeRosterMember: async () => true,
  denyAccessRequest: async () => undefined,
}));
vi.mock('../lib/api/apiKeys', () => ({
  fetchApiKeys: async () => [
    { id: 'apk_1', name: 'Nightly inventory sync', prefix: 'pk_live_ab', last4: 'z9q2', scopes: ['READ', 'WRITE'], status: 'ACTIVE', createdAt: '2026-10-01T00:00:00Z', createdBy: 'ada@example.com', lastUsedAt: null, expiresAt: null, revokedAt: null },
  ],
  createApiKey: async () => ({ apiKey: {}, secret: 's' }),
  revokeApiKey: async () => undefined,
  deleteApiKey: async () => undefined,
}));
vi.mock('../lib/api/glean', async (orig) => ({
  ...(await orig<typeof import('../lib/api/glean')>()),
  gleanConnection: async () => ({ configured: true, baseUrl: 'https://tenant-be.example.net', connected: true, needsReconnect: false, email: 'ada@example.com', scopes: ['chat'], expiresAt: null }),
  fetchGleanIndexRuns: async () => [{ id: 'run_1', type: 'full', status: 'success', startedAt: '2026-10-16T01:00:00Z', completedAt: '2026-10-16T01:05:00Z', processed: 3 }],
  triggerGleanIndex: async () => true,
}));
vi.mock('../lib/api/loginActivity', () => ({
  fetchLoginActivity: async () => ({ items: [{ id: '1', email: 'ada@example.com', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130 Safari/537.36', createdAt: '2026-10-16T02:00:00Z' }], total: 1 }),
}));
vi.mock('../lib/api/notifications', () => ({ fetchNotifications: async () => [], markNotificationRead: async () => undefined }));
vi.mock('../lib/api/logos', () => ({ fetchLogos: async () => new Map() }));
vi.mock('../lib/auth/userManager', () => ({ logout: async () => undefined, getIdToken: async () => 't', login: async () => undefined }));
vi.mock('../lib/telemetry', () => ({ recordPage: () => undefined, recordRouteTransition: () => undefined, setTelemetryUser: () => undefined, initTelemetry: () => undefined, recordEvent: () => undefined }));

const renderAt = (path: string, user: User = me) =>
  render(
    <CurrentUserContext.Provider value={user}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </CurrentUserContext.Provider>,
  );

describe('portal shell with an empty domain', () => {
  it('home shows the welcome, the Glean connection and Ask Glean', async () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: /Welcome, Ada/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy());
    expect(screen.getByLabelText('Question for Glean')).toBeTruthy();
  });

  it('the workspace nav has Home and People only', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: /Home/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /People/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Items/ })).toBeNull();
  });

  it('people renders the user registry', async () => {
    renderAt('/users');
    await waitFor(() => expect(screen.getByText('Ada Admin')).toBeTruthy());
  });

  it('admin screens render for an administrator', async () => {
    renderAt('/admin/roles');
    await waitFor(() => expect(screen.getByText('Nia New')).toBeTruthy());
    renderAt('/admin/api-keys');
    await waitFor(() => expect(screen.getByText('Nightly inventory sync')).toBeTruthy());
    renderAt('/admin/glean');
    await waitFor(() => expect(screen.getByText('Re-index now')).toBeTruthy());
    renderAt('/admin/login-activity');
    await waitFor(() => expect(screen.getByText(/Chrome · macOS/)).toBeTruthy());
  });

  it('an unknown route redirects home', async () => {
    renderAt('/items');
    expect(await screen.findByRole('heading', { name: /Welcome, Ada/ })).toBeTruthy();
  });

  it('the sidebar hides admin for a viewer and admin routes redirect home', async () => {
    renderAt('/admin/api-keys', { ...me, role: 'VIEWER', isAdmin: false });
    expect(screen.queryByText('API keys')).toBeNull();
    expect(await screen.findByRole('heading', { name: /Welcome, Ada/ })).toBeTruthy();
  });
});
