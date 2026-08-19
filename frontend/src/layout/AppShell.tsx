import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { ApiError, apiFetch } from '../lib/api';
import './shell.css';

interface Organization {
  id: string;
  name: string;
}

export function AppShell() {
  const { logout } = useAuth();
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
          <NavLink to="/app/properties" className={({ isActive }) => (isActive ? 'shell-nav-active' : '')}>
            Properties
          </NavLink>
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
