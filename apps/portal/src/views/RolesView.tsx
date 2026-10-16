// Admin > Roles & access: the roster (who may use the portal, with what role
// and whether they are an administrator) and the pending access requests
// (sign-ins by people not yet on the roster). Grant, change, remove, deny.
import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Field } from '../components/ui/Field';
import { Spinner } from '../components/ui/Spinner';
import { useCurrentUser } from '../data/useCurrentUser';
import { ROLES, type AccessRequest, type Role, type RosterMember } from '../data/types';
import {
  denyAccessRequest,
  fetchAccessRequests,
  fetchAccessRoster,
  removeRosterMember,
  updateRosterMember,
} from '../lib/api/identity';
import { useAsyncData } from '../lib/api/useAsyncData';
import { formatDate, roleLabel } from '../lib/labels';
import { useSaveAction } from '../lib/saveAction';

export function RolesView() {
  const me = useCurrentUser();
  const [refreshKey, setRefreshKey] = useState(0);
  const [grant, setGrant] = useState<{ email: string; role: Role; isAdmin: boolean } | null>(null);
  const roster = useAsyncData(fetchAccessRoster, [refreshKey], [] as RosterMember[]);
  const requests = useAsyncData(fetchAccessRequests, [refreshKey], [] as AccessRequest[]);
  const { saving, run } = useSaveAction();
  const refresh = () => setRefreshKey((k) => k + 1);

  const change = (m: RosterMember, patch: Partial<Pick<RosterMember, 'role' | 'isAdmin'>>) =>
    void run({
      action: () => updateRosterMember(m.email, patch.role ?? m.role, patch.isAdmin ?? m.isAdmin),
      successMsg: `Updated ${m.name ?? m.email}`,
      onDone: refresh,
    });

  return (
    <div>
      <header className="ps-page__header">
        <div>
          <h1 className="ps-page-title">Roles & access</h1>
          <p className="ps-page-subtitle">
            Three roles: Administrator and Editor may change data, Viewer reads. Admin is a separate flag any role can
            carry. You cannot change your own access, and the last administrator cannot be demoted.
          </p>
        </div>
        <Button variant="primary" iconLeft={<UserPlus size={14} />} onClick={() => setGrant({ email: '', role: 'VIEWER', isAdmin: false })}>
          Grant access
        </Button>
      </header>

      <div style={{ display: 'grid', gap: 20 }}>
        {requests.data.length > 0 && (
          <Card>
            <CardHeader title="Access requests" subtitle="Signed in, not yet on the roster." />
            <CardBody flush>
              <table className="ps-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Attempts</th>
                    <th>Last seen</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {requests.data.map((r) => (
                    <tr key={r.email}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.name ?? r.email}</div>
                        <div className="ps-text-subtle" style={{ fontSize: 12 }}>{r.email}</div>
                      </td>
                      <td>{r.attempts}</td>
                      <td className="ps-text-subtle">{formatDate(r.lastSeen)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="ps-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <Button size="sm" variant="primary" onClick={() => setGrant({ email: r.email, role: 'VIEWER', isAdmin: false })}>
                            Grant
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={saving}
                            onClick={() => void run({ action: () => denyAccessRequest(r.email), successMsg: `Dismissed ${r.email}`, onDone: refresh })}
                          >
                            Dismiss
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Roster" subtitle={`${roster.data.length} member${roster.data.length === 1 ? '' : 's'}`} />
          <CardBody flush>
            {roster.loading && roster.data.length === 0 ? (
              <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
                <Spinner />
              </div>
            ) : roster.error ? (
              <EmptyState title="Couldn't load the roster" body={roster.error} />
            ) : roster.data.length === 0 ? (
              <EmptyState title="Roster is empty" body="Seed the first administrator in app.access_roster (see the README), then grant access here." />
            ) : (
              <table className="ps-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Admin</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {roster.data.map((m) => {
                    const self = m.email === me?.email?.toLowerCase();
                    return (
                      <tr key={m.email}>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {m.name ?? m.email} {self && <Badge tone="brand">You</Badge>}
                          </div>
                          <div className="ps-text-subtle" style={{ fontSize: 12 }}>{m.email}</div>
                        </td>
                        <td>
                          <select className="ps-select" value={m.role} disabled={self || saving} onChange={(e) => change(m, { role: e.target.value as Role })} aria-label={`Role for ${m.email}`}>
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <label className="ps-row" style={{ gap: 6 }}>
                            <input type="checkbox" checked={m.isAdmin} disabled={self || saving} onChange={(e) => change(m, { isAdmin: e.target.checked })} />
                            <span className="ps-text-subtle">Administrator</span>
                          </label>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={self || saving}
                            onClick={() => void run({ action: () => removeRosterMember(m.email), successMsg: `Removed ${m.email}`, onDone: refresh })}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={grant !== null}
        title="Grant access"
        subtitle="Adds or updates a roster entry. The person signs in with their organisation account."
        onClose={() => setGrant(null)}
        primaryAction={{
          label: saving ? 'Saving…' : 'Grant',
          disabled: !grant?.email.includes('@') || saving,
          onClick: () =>
            grant &&
            void run({
              action: () => updateRosterMember(grant.email.trim().toLowerCase(), grant.role, grant.isAdmin),
              successMsg: `Granted ${grant.role.toLowerCase()} access to ${grant.email}`,
              onDone: () => {
                setGrant(null);
                refresh();
              },
            }),
        }}
      >
        {grant && (
          <div className="ps-form-grid">
            <Field label="Email" fullWidth>
              <input className="ps-input" type="email" value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.target.value })} autoFocus />
            </Field>
            <Field label="Role">
              <select className="ps-select" value={grant.role} onChange={(e) => setGrant({ ...grant, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Administrator">
              <label className="ps-row" style={{ gap: 6 }}>
                <input type="checkbox" checked={grant.isAdmin} onChange={(e) => setGrant({ ...grant, isAdmin: e.target.checked })} />
                <span className="ps-text-subtle">Can manage roles, keys, and settings</span>
              </label>
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
