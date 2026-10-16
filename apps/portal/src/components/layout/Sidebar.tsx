// Navigation. Items are a static list gated by the caller's capabilities; add
// your domain's screens to WORKSPACE.
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Boxes, Cloud, Home, KeyRound, Link2, LogIn, Users, UserCog } from 'lucide-react';
import { GleanLogo } from '../ui/GleanLogo';
import { Avatar } from '../ui/Avatar';
import { useCurrentUser } from '../../data/useCurrentUser';
import { canAdmin } from '../../lib/capabilities';
import { roleLabel } from '../../lib/labels';

interface Item {
  to: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
}

const ICON = 16;

const WORKSPACE: Item[] = [
  { to: '/', label: 'Home', icon: <Home size={ICON} />, exact: true },
  { to: '/items', label: 'Items', icon: <Boxes size={ICON} /> },
  { to: '/users', label: 'People', icon: <Users size={ICON} /> },
];

const ADMIN: Item[] = [
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

function SidebarLink({ to, label, icon, exact }: Item) {
  return (
    <NavLink to={to} end={exact} className={({ isActive }) => `ps-nav-link${isActive ? ' ps-nav-link--active' : ''}`}>
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}
