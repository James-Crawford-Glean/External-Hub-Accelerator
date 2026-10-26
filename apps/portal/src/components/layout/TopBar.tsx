// Breadcrumb from the current route, the notification bell, and the account
// menu (signed-in email + sign out).
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { NotificationsMenu } from './NotificationsMenu';
import { useCurrentUser } from '../../data/useCurrentUser';
import { DOMAIN } from '../../domain';
import { logout } from '../../lib/auth/userManager';
import { PORTAL_NAME } from '../../lib/api/config';

interface Crumb {
  label: string;
  to?: string;
}

const LABELS: Record<string, string> = {
  users: 'People',
  admin: 'Admin',
  roles: 'Roles & access',
  'api-keys': 'API keys',
  glean: 'Glean',
  'login-activity': 'Login activity',
  aws: 'AWS',
  callback: 'Connecting Glean',
  ...DOMAIN.crumbLabels,
};

function crumbsFor(pathname: string): Crumb[] {
  const parts = pathname.split('/').filter(Boolean);
  const out: Crumb[] = [{ label: PORTAL_NAME, to: '/' }];
  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    out.push({ label: LABELS[part] ?? DOMAIN.crumbLabelForId?.(part) ?? part, to: acc });
  }
  return out;
}

export function TopBar() {
  const { pathname } = useLocation();
  const crumbs = crumbsFor(pathname);
  return (
    <header className="ps-topbar">
      <nav className="ps-topbar__breadcrumb" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={c.to ?? c.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <ChevronRight size={14} color="var(--color-ink-faint)" />}
            {c.to && i < crumbs.length - 1 ? (
              <Link to={c.to} style={{ color: 'var(--color-ink-muted)' }}>
                {c.label}
              </Link>
            ) : (
              <span className={i === crumbs.length - 1 ? 'ps-topbar__breadcrumb-current' : ''}>{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="ps-topbar__spacer" />
      <div className="ps-topbar__actions">
        <NotificationsMenu />
        <AccountMenu />
      </div>
    </header>
  );
}

function AccountMenu() {
  const me = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const email = me?.email ?? '';
  const name = me?.name ?? email;

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="ps-topbar__new" ref={ref}>
      <button className="ps-topbar__icon-btn" aria-label="Account" title={email || 'Account'} onClick={() => setOpen((o) => !o)}>
        {me?.avatarUrl && imgOk ? (
          <img
            src={me.avatarUrl}
            alt=""
            onError={() => setImgOk(false)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' }}
          />
        ) : (
          (name || '?').slice(0, 1).toUpperCase()
        )}
      </button>
      {open && (
        <div className="ps-topbar__new-menu" role="menu">
          <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--color-ink-muted)' }}>
            Signed in as
            <div style={{ color: 'var(--color-ink-strong)', fontWeight: 500 }}>{email || '—'}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            <span className="ps-topbar__new-menu-label">Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
