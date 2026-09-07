import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { hasPermission } from '../auth/session';
import { canReadGuests } from '../features/guests/permissions';
import { canReadStaff } from '../features/staff/permissions';
import { ApiError, apiFetch } from '../lib/api';
import './shell.css';

interface Organization {
  id: string;
  name: string;
}

export function AppShell() {
  const { logout, session } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);

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

  return (
    <div className="shell">
      <header className="shell-topbar">
        <span className="shell-org-name">{organization?.name ?? 'The Living Canvas'}</span>
        <nav className="shell-nav">
          <NavLink to="/app" end className={({ isActive }) => (isActive ? 'shell-nav-active' : '')}>
            Dashboard
          </NavLink>
          <NavLink to="/app/properties" className={({ isActive }) => (isActive ? 'shell-nav-active' : '')}>
            Properties
          </NavLink>
          {/* Guests are organization-scoped, so this is a top-level entry
              rather than nested under a property. Presentation-only gating:
              the route and the API both enforce `guests:read` independently. */}
          {canReadGuests(session) && (
            <NavLink to="/app/guests" className={({ isActive }) => (isActive ? 'shell-nav-active' : '')}>
              Guests
            </NavLink>
          )}
          {/* Hidden without `staff:read` so the nav doesn't advertise a
              page that would only explain itself as unavailable. The route
              still guards itself — this is presentation, not access
              control. */}
          {canReadStaff(session) && (
            <NavLink to="/app/staff" className={({ isActive }) => (isActive ? 'shell-nav-active' : '')}>
              Team
            </NavLink>
          )}
          {/* Same presentation-only gating as Team: the route and the API
              both enforce `audit:read` independently. */}
          {hasPermission(session, 'audit:read') && (
            <NavLink to="/app/audit" className={({ isActive }) => (isActive ? 'shell-nav-active' : '')}>
              Activity
            </NavLink>
          )}
        </nav>
        <button type="button" className="shell-logout" onClick={() => void handleLogout()}>
          Log out
        </button>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
