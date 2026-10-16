// @vitest-environment jsdom
// Renders every route with the API layer mocked. Proves the shell and views
// compose against the platform schema without a browser or a backend.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { CurrentUserContext } from '../data/useCurrentUser';
import type { Item, User } from '../data/types';

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
const item: Item = {
  id: 'itm_00000000000001',
  externalId: 'EX-1001',
  name: 'Northwind Traders',
  category: 'Distributor',
  status: 'ACTIVE',
  description: 'Regional distributor.',
  website: 'northwind.example',
  owner: { id: 'usr_2', email: 'owner.one@example.com', name: 'Owner One' },
  visibilityRole: null,
  source: 'sync',
  syncedAt: '2026-10-16T01:00:00Z',
  indexedAt: '2026-10-16T01:05:00Z',
  reviewedAt: null,
  reviewedBy: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-16T01:00:00Z',
};
const draft: Item = {
  ...item,
  id: 'itm_00000000000002',
  externalId: null,
  name: 'Contoso Logistics',
  status: 'DRAFT',
  source: 'mcp',
  syncedAt: null,
  indexedAt: null,
};
const itemsById: Record<string, Item> = { [item.id]: item, [draft.id]: draft };
const approveItem = vi.fn(async (id: string) => ({ ...itemsById[id]!, status: 'ACTIVE' as const, reviewedAt: '2026-10-16T03:00:00Z', reviewedBy: me.email }));
const rejectItem = vi.fn(async (id: string) => ({ ...itemsById[id]!, status: 'REJECTED' as const, reviewedAt: '2026-10-16T03:00:00Z', reviewedBy: me.email }));

vi.mock('../lib/api/items', () => ({
  fetchItems: async (filter: { draftsOnly?: boolean }) => (filter.draftsOnly ? { items: [draft], total: 1 } : { items: [item], total: 1 }),
  fetchItem: async (id: string) => itemsById[id] ?? null,
  fetchItemCategories: async () => ['Distributor'],
  createItem: async () => item,
  updateItem: async () => item,
  archiveItem: async () => item,
  approveItem: (id: string) => approveItem(id),
  rejectItem: (id: string) => rejectItem(id),
  fetchGleanIndexRuns: async () => [{ id: 'run_1', type: 'full', status: 'success', startedAt: '2026-10-16T01:00:00Z', completedAt: '2026-10-16T01:05:00Z', processed: 3 }],
  triggerGleanIndex: async () => true,
}));
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
}));
vi.mock('../lib/api/loginActivity', () => ({
  fetchLoginActivity: async () => ({ items: [{ id: '1', email: 'ada@example.com', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130 Safari/537.36', createdAt: '2026-10-16T02:00:00Z' }], total: 1 }),
}));
vi.mock('../lib/api/notifications', () => ({ fetchNotifications: async () => [], markNotificationRead: async () => undefined }));
vi.mock('../lib/api/logos', () => ({ fetchLogos: async () => new Map() }));
vi.mock('../lib/auth/userManager', () => ({ logout: async () => undefined, getIdToken: async () => 't', login: async () => undefined }));
vi.mock('../lib/telemetry', () => ({ recordPage: () => undefined, recordRouteTransition: () => undefined, setTelemetryUser: () => undefined, initTelemetry: () => undefined, recordEvent: () => undefined }));

const renderAt = (path: string) =>
  render(
    <CurrentUserContext.Provider value={me}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </CurrentUserContext.Provider>,
  );

describe('portal routes', () => {
  it('home shows the welcome, metrics, recent items and Ask Glean', async () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: /Welcome, Ada/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Northwind Traders' })).toBeTruthy());
    expect(screen.getByLabelText('Question for Glean')).toBeTruthy();
  });

  it('items list renders rows and the create button for a writer', async () => {
    renderAt('/items');
    await waitFor(() => expect(screen.getByText('Northwind Traders')).toBeTruthy());
    expect(screen.getByRole('button', { name: /New item/ })).toBeTruthy();
  });

  it('item detail shows the record facts', async () => {
    renderAt('/items/itm_00000000000001');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Northwind Traders' })).toBeTruthy());
    expect(screen.getByText('EX-1001')).toBeTruthy();
    expect(screen.getByText('Everyone')).toBeTruthy();
    expect(screen.queryByText(/Awaiting review/)).toBeNull();
  });

  it('a writer can open the review queue from the status filter', async () => {
    renderAt('/items');
    await waitFor(() => expect(screen.getByText('Northwind Traders')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'DRAFT' } });
    await waitFor(() => expect(screen.getByText('Contoso Logistics')).toBeTruthy());
    expect(screen.queryByText('Northwind Traders')).toBeNull();
  });

  it('a draft shows the review banner and approve publishes it', async () => {
    renderAt('/items/itm_00000000000002');
    await waitFor(() => expect(screen.getByText(/Awaiting review/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(approveItem).toHaveBeenCalledWith('itm_00000000000002'));
    expect(rejectItem).not.toHaveBeenCalled();
  });

  it('a viewer sees the draft banner without the review actions', async () => {
    const viewer: User = { ...me, role: 'VIEWER', isAdmin: false };
    render(
      <CurrentUserContext.Provider value={viewer}>
        <MemoryRouter initialEntries={['/items/itm_00000000000002']}>
          <App />
        </MemoryRouter>
      </CurrentUserContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText(/Awaiting review/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject/ })).toBeNull();
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

  it('the sidebar hides admin for a viewer and admin routes redirect home', async () => {
    const viewer: User = { ...me, role: 'VIEWER', isAdmin: false };
    render(
      <CurrentUserContext.Provider value={viewer}>
        <MemoryRouter initialEntries={['/admin/api-keys']}>
          <App />
        </MemoryRouter>
      </CurrentUserContext.Provider>,
    );
    expect(screen.queryByText('API keys')).toBeNull();
    expect(await screen.findByRole('heading', { name: /Welcome, Ada/ })).toBeTruthy();
  });
});
