import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { hasPermission } from '../auth/session';
import { AssistantWidget } from '../features/assistant/AssistantWidget';
import { canReadGuests } from '../features/guests/permissions';
import { canReadStaff } from '../features/staff/permissions';
import { ApiError, apiFetch } from '../lib/api';
import { setFlash } from '../lib/flash';
import { fetchProfile, type Profile } from '../lib/profile';
import { NavIcon } from './NavIcon';
import { useActiveProperty } from './useActiveProperty';
import './shell.css';

interface Organization {
  id: string;
  name: string;
}

export function AppShell() {
  const { logout, session } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const location = useLocation();
  const mayReadProperties = hasPermission(session, 'properties:read');
  const { properties, activeId, active, select } = useActiveProperty(mayReadProperties);
  const can = (perm: string) => hasPermission(session, perm);
  const hotelLinks: {
    to: string;
    label: string;
    icon: Parameters<typeof NavIcon>[0]['name'];
    perm?: string;
  }[] = [
    {
      to: 'dashboard',
      label: 'Front desk',
      icon: 'frontdesk',
      perm: 'dashboard:read',
    },
    {
      to: 'calendar',
      label: 'Tape chart',
      icon: 'calendar',
      perm: 'reservations:read',
    },
    {
      to: 'reservations',
      label: 'Reservations',
      icon: 'reservations',
      perm: 'reservations:read',
    },
    {
      to: 'housekeeping',
      label: 'Housekeeping',
      icon: 'housekeeping',
      perm: 'housekeeping:read',
    },
    {
      to: 'maintenance',
      label: 'Maintenance',
      icon: 'maintenance',
      perm: 'maintenance:read',
    },
    { to: 'pos', label: 'Point of sale', icon: 'pos', perm: 'pos:read' },
    {
      to: 'reports',
      label: 'Revenue & reports',
      icon: 'reports',
      perm: 'reports:read',
    },
    {
      to: 'marketing',
      label: 'Marketing studio',
      icon: 'marketing',
      perm: 'marketing:read',
    },
    { to: 'rooms', label: 'Rooms & rates', icon: 'rooms' },
  ];

  // Close the mobile drawer on navigation and move focus to the top.
  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    fetchProfile()
      .then(setProfile)
      .catch(() => undefined);
  }, [location.pathname]);

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
    setFlash('You’ve been signed out.');
    try {
      await logout();
    } catch (error) {
      if (error instanceof ApiError && import.meta.env.DEV) console.warn(error.message);
    }
  }

  const orgName = organization?.name ?? 'The Living Canvas';
  const displayName = profile ? `${profile.firstName} ${profile.lastName}` : orgName;
  const orgInitials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  const primaryRole = session?.roleNames[0] ?? 'Member';

  const navLinkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link nav-link-active' : 'nav-link');

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

          {activeId && (
            <div className="nav-group" aria-label="Hotel">
              <span className="nav-group-label">Hotel</span>
              {properties.length > 1 ? (
                <select
                  className="nav-property-select"
                  aria-label="Active property"
                  value={activeId}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => select(e.target.value)}
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                active && <span className="nav-property-name">{active.name}</span>
              )}
              {hotelLinks
                .filter((l) => !l.perm || can(l.perm))
                .map((l) => (
                  <NavLink key={l.to} to={`/app/properties/${activeId}/${l.to}`} className={navLinkClass}>
                    <NavIcon name={l.icon} />
                    <span>{l.label}</span>
                  </NavLink>
                ))}
            </div>
          )}

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

          <div className="nav-group">
            <span className="nav-group-label">Account</span>
            <NavLink to="/app/settings" className={navLinkClass}>
              <NavIcon name="settings" />
              <span>Settings</span>
            </NavLink>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-user-avatar" aria-hidden="true">
              {orgInitials || 'LC'}
            </span>
            <span className="sidebar-user-text">
              <span className="sidebar-user-name">{displayName}</span>
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
        {profile?.isDemo && (
          <div className="shell-banner shell-banner-info" role="note">
            <span>
              You’re exploring the <strong>shared demo hotel</strong> — data resets periodically and is visible to other
              visitors.
            </span>
            <Link to="/signup" onClick={() => void logout()}>
              Create your own workspace →
            </Link>
          </div>
        )}
        {profile && !profile.isDemo && !profile.emailVerifiedAt && !bannerDismissed && (
          <div className="shell-banner" role="status">
            <span>
              Please verify your email — we sent a link to <strong>{profile.email}</strong>.
            </span>
            <span className="shell-banner-actions">
              <Link to="/app/settings">Resend link</Link>
              <button type="button" aria-label="Dismiss" onClick={() => setBannerDismissed(true)}>
                ×
              </button>
            </span>
          </div>
        )}
        <main className="shell-main" id="main">
          <Outlet />
        </main>
      </div>

      <AssistantWidget propertyId={activeId ?? undefined} />
    </div>
  );
}
