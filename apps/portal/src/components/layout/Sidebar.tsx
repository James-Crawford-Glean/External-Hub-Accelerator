// Navigation: a static list gated by the caller's capabilities. The domain's
// screens come from its registration (src/domain.tsx).
import { NavLink } from 'react-router-dom';
import { Cloud, Home, KeyRound, Link2, LogIn, Users, UserCog } from 'lucide-react';
import { GleanLogo } from '../ui/GleanLogo';
import { Avatar } from '../ui/Avatar';
import { useCurrentUser } from '../../data/useCurrentUser';
import { DOMAIN } from '../../domain';
import { canAdmin } from '../../lib/capabilities';
import type { DomainNavItem } from '../../lib/domain';
import { roleLabel } from '../../lib/labels';

interface Entry extends DomainNavItem {
  exact?: boolean;
}

const ICON = 16;

const WORKSPACE: Entry[] = [
  { to: '/', label: 'Home', icon: <Home size={ICON} />, exact: true },
  ...DOMAIN.nav,
  { to: '/users', label: 'People', icon: <Users size={ICON} /> },
];

const ADMIN: Entry[] = [
  { to: '/admin/roles', label: 'Roles & access', icon: <UserCog size={ICON} /> },
  { to: '/admin/api-keys', label: 'API keys', icon: <KeyRound size={ICON} /> },
  { to: '/admin/glean', label: 'Glean', icon: <Link2 size={ICON} /> },
  { to: '/admin/login-activity', label: 'Login activity', icon: <LogIn size={ICON} /> },
  { to: '/admin/aws', label: 'AWS', icon: <Cloud size={ICON} /> },
];

export function Sidebar() {
  const me = useCurrentUser();
  return (
    <aside className="ps-sidebar">
      <div className="ps-sidebar__brand">
        <GleanLogo />
      </div>
      <nav className="ps-sidebar__nav">
        <div className="ps-sidebar__section">Workspace</div>
        {WORKSPACE.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
        {canAdmin(me) && (
          <>
            <div className="ps-sidebar__section">Admin</div>
            {ADMIN.map((item) => (
              <SidebarLink key={item.to} {...item} />
            ))}
          </>
        )}
      </nav>
      <div className="ps-sidebar__footer">
        {me && (
          <div className="ps-sidebar__profile" style={{ cursor: 'default' }} data-testid="identity-footer">
            <Avatar name={me.name} initials={me.initials} size="sm" image={me.avatarUrl} />
            <div className="ps-sidebar__profile-meta">
              <span className="ps-sidebar__profile-name">{me.name}</span>
              <span className="ps-sidebar__profile-role">{roleLabel(me.role)}{me.isAdmin ? ' · Admin' : ''}</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function SidebarLink({ to, label, icon, exact }: Entry) {
  return (
    <NavLink to={to} end={exact} className={({ isActive }) => `ps-nav-link${isActive ? ' ps-nav-link--active' : ''}`}>
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}
