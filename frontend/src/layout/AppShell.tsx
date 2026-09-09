import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { hasPermission } from '../auth/session';
import { canReadGuests } from '../features/guests/permissions';
import { canReadStaff } from '../features/staff/permissions';
import { ApiError, apiFetch } from '../lib/api';
import { NavIcon } from './NavIcon';
import './shell.css';

interface Organization {
  id: string;
  name: string;
}

export function AppShell() {
  const { logout, session } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    apiFetch<{ organization: Organization }>('/api/v1/organizations/me')
      .then((res) => setOrganization(res.organization))
      .catch((error: unknown) => {
        // Non-fatal — the shell still works without the org name showing;
        // ApiError already carries a readable message if this ever needs
        // surfacing somewhere more visible.
        if (import.meta.env.DEV) console.warn('Could not load organization:', error);
      });
  }, []);

  async function handleLogout() {
    try {
      await logout();
    } catch (error) {
      if (error instanceof ApiError && import.meta.env.DEV) console.warn(error.message);
    }
  }

  const orgName = organization?.name ?? 'The Living Canvas';
  const orgInitials = orgName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  const primaryRole = session?.roleNames[0] ?? 'Member';

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-link nav-link-active' : 'nav-link';

  return (
    <div className={`shell ${mobileOpen ? 'shell-mobile-open' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark" aria-hidden="true">
            <NavIcon name="brand" />
          </span>
          <span className="sidebar-brand-text">
            <span className="sidebar-brand-name">{orgName}</span>
            <span className="sidebar-brand-sub">Property Management</span>
          </span>
        </div>

        <nav className="sidebar-nav" onClick={() => setMobileOpen(false)}>
          <div className="nav-group">
            <span className="nav-group-label">Overview</span>
            <NavLink to="/app" end className={navLinkClass}>
              <NavIcon name="dashboard" />
              <span>Dashboard</span>
            </NavLink>
            <NavLink to="/app/properties" className={navLinkClass}>
              <NavIcon name="properties" />
              <span>Properties</span>
            </NavLink>
          </div>

          <div className="nav-group">
            <span className="nav-group-label">Management</span>
            {canReadGuests(session) && (
              <NavLink to="/app/guests" className={navLinkClass}>
                <NavIcon name="guests" />
                <span>Guests</span>
              </NavLink>
            )}
            {canReadStaff(session) && (
              <NavLink to="/app/staff" className={navLinkClass}>
                <NavIcon name="team" />
                <span>Team</span>
              </NavLink>
            )}
            {hasPermission(session, 'notifications:read') && (
              <NavLink to="/app/notifications" className={navLinkClass}>
                <NavIcon name="notifications" />
                <span>Notifications</span>
              </NavLink>
            )}
            {hasPermission(session, 'audit:read') && (
              <NavLink to="/app/audit" className={navLinkClass}>
                <NavIcon name="activity" />
                <span>Activity</span>
              </NavLink>
            )}
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-user-avatar" aria-hidden="true">
              {orgInitials || 'LC'}
            </span>
            <span className="sidebar-user-text">
              <span className="sidebar-user-name">{orgName}</span>
              <span className="sidebar-user-role">{primaryRole}</span>
            </span>
          </div>
          <button type="button" className="sidebar-logout" onClick={() => void handleLogout()}>
            <NavIcon name="logout" />
            <span>Log out</span>
          </button>
        </div>
      </aside>

      <button
        type="button"
        className="shell-backdrop"
        aria-label="Close navigation"
        onClick={() => setMobileOpen(false)}
      />

      <div className="shell-content">
        <header className="shell-topbar">
          <button
            type="button"
            className="shell-menu-btn"
            aria-label="Toggle navigation"
            onClick={() => setMobileOpen((open) => !open)}
          >
            <NavIcon name="menu" />
          </button>
          <span className="shell-topbar-org">{orgName}</span>
        </header>
        <main className="shell-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
