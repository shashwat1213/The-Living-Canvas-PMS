import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../auth/AuthContext';
import { readSessionClaims } from '../auth/session';
import { DashboardPage } from './DashboardPage';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function token(permissions: string[]): string {
  const payload = btoa(
    JSON.stringify({ sub: 'u', organizationId: 'o', permissions, roleNames: ['OWNER'], grantedPropertyIds: [] }),
  );
  return `h.${payload}.s`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDashboard(permissions = ['properties:read', 'properties:create', 'dashboard:read']) {
  const value: AuthContextValue = {
    status: 'authenticated',
    session: readSessionClaims(token(permissions)),
    login: vi.fn(),
    logout: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const PROPERTY = {
  id: 'p1',
  name: 'Grand Palace',
  slug: 'grand-palace',
  timezone: 'Asia/Kolkata',
  city: 'Mumbai',
  country: 'India',
  isActive: true,
};

const VIEW = {
  date: '2026-10-20',
  summary: {
    arrivals: 3,
    departures: 2,
    inHouse: 7,
    occupancyPct: 70,
    sellableRooms: 10,
    occupiedRooms: 7,
    roomsToClean: 4,
    roomsOutOfService: 0,
    openWorkOrders: 1,
    urgentWorkOrders: 0,
    unsettledFolios: 1,
    unsettledBalanceMinor: 1250000,
  },
};

function stub(routes: { properties: unknown[]; dashboardFails?: boolean; orgFails?: boolean }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/organizations/me')) {
        return Promise.resolve(
          routes.orgFails
            ? jsonResponse({ error: { message: 'Could not load your dashboard.' } }, false)
            : jsonResponse({ organization: { id: 'o', name: 'Palace Group' } }),
        );
      }
      if (url.includes('/dashboard')) {
        return Promise.resolve(routes.dashboardFails ? jsonResponse({}, false) : jsonResponse(VIEW));
      }
      return Promise.resolve(
        jsonResponse({ properties: routes.properties, page: { page: 1, pageSize: 12, totalItems: routes.properties.length, totalPages: 1 } }),
      );
    }),
  );
}

describe('DashboardPage (portfolio overview)', () => {
  it('shows a skeleton while loading', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    renderDashboard();
    expect(screen.getByRole('status')).toHaveTextContent('Loading dashboard');
  });

  it('aggregates real per-property front-desk numbers', async () => {
    stub({ properties: [PROPERTY] });
    renderDashboard();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Palace Group');
    expect(screen.getByText('Arrivals today').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('In-house guests').nextSibling).toHaveTextContent('7');
    expect(screen.getByText('Occupancy tonight').nextSibling).toHaveTextContent('70%');
    expect(screen.getByRole('heading', { name: 'Grand Palace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Front desk' })).toHaveAttribute('href', '/app/properties/p1/dashboard');
  });

  it('guides a brand-new workspace to the setup wizard', async () => {
    stub({ properties: [] });
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'No properties yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start guided setup' })).toHaveAttribute('href', '/app/welcome');
  });

  it('still lists properties when a per-property dashboard call fails', async () => {
    stub({ properties: [PROPERTY], dashboardFails: true });
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'Grand Palace' })).toBeInTheDocument();
  });

  it('shows an error with a retry when loading fails', async () => {
    stub({ properties: [], orgFails: true });
    renderDashboard();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your dashboard.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
