import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRouter } from './AppRouter';
import { AuthContext, type AuthContextValue } from './auth/AuthContext';
import { readSessionClaims } from './auth/session';

/**
 * Route registration, as opposed to page behaviour.
 *
 * Every feature page has its own suite that mounts it under a route the
 * test declares itself — which passes whether or not the route exists in
 * the real router. This covers the wiring those suites can't: that the
 * path is registered, and that it is registered *inside* the
 * authenticated shell rather than beside it.
 */
function makeToken(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function renderAt(path: string, status: AuthContextValue['status']) {
  const value: AuthContextValue = {
    status,
    session:
      status === 'authenticated'
        ? readSessionClaims(
            makeToken({
              sub: 'user-1',
              organizationId: 'org-1',
              permissions: ['properties:read', 'room-types:read', 'room-types:manage', 'dashboard:read', 'reports:read', 'pos:read', 'pos:operate', 'pos:manage'],
              roleNames: ['OWNER'],
              grantedPropertyIds: ['prop-1'],
            }),
          )
        : null,
    login: vi.fn(),
    logout: vi.fn(),
  };

  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <AppRouter />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppRouter — room-type catalogue route', () => {
  it('renders the catalogue at /app/properties/:propertyId/room-types', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              url.includes('/room-types')
                ? { roomTypes: [], page: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 } }
                : url.includes('/organizations/me')
                  ? { organization: { id: 'org-1', name: 'Canvas Group' } }
                  : { property: { id: 'prop-1', name: 'Seaside Villa' } },
            ),
        } as Response),
      ),
    );

    renderAt('/app/properties/prop-1/room-types', 'authenticated');

    expect(await screen.findByRole('heading', { name: 'Room types — Seaside Villa' })).toBeInTheDocument();
  });

  it('sends an anonymous visitor to login instead of the catalogue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response));

    renderAt('/app/properties/prop-1/room-types', 'anonymous');

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Room types/ })).not.toBeInTheDocument();
  });
});

describe('AppRouter — property dashboard route', () => {
  it('renders the cockpit at /app/properties/:propertyId/dashboard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              url.includes('/dashboard')
                ? {
                    date: '2026-10-10',
                    summary: {
                      arrivals: 0,
                      departures: 0,
                      inHouse: 0,
                      occupancyPct: 0,
                      sellableRooms: 0,
                      occupiedRooms: 0,
                      roomsToClean: 0,
                      roomsOutOfService: 0,
                      openWorkOrders: 0,
                      urgentWorkOrders: 0,
                      unsettledFolios: 0,
                      unsettledBalanceMinor: 0,
                    },
                    arrivals: [],
                    departures: [],
                    inHouse: [],
                    housekeeping: { dirty: 0, cleaning: 0, clean: 0, inspected: 0, openTasks: 0 },
                    maintenance: { open: 0, urgent: 0, roomsOutOfService: 0 },
                    unsettledFolioList: [],
                  }
                : { property: { id: 'prop-1', name: 'Seaside Villa' } },
            ),
        } as Response),
      ),
    );

    renderAt('/app/properties/prop-1/dashboard', 'authenticated');

    expect(await screen.findByRole('heading', { name: 'Dashboard — Seaside Villa' })).toBeInTheDocument();
  });

  it('sends an anonymous visitor to login instead of the cockpit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response));

    renderAt('/app/properties/prop-1/dashboard', 'anonymous');

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Dashboard/ })).not.toBeInTheDocument();
  });
});

describe('AppRouter — reports route', () => {
  it('renders the revenue report at /app/properties/:propertyId/reports', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              url.includes('/reports/revenue')
                ? {
                    from: '2026-10-01',
                    to: '2026-10-02',
                    nights: 1,
                    sellableRooms: 2,
                    summary: {
                      roomRevenueMinor: 0,
                      roomsSold: 0,
                      roomNightsAvailable: 2,
                      occupancyPct: 0,
                      adrMinor: 0,
                      revparMinor: 0,
                      paymentsCollectedMinor: 0,
                    },
                    days: [
                      {
                        date: '2026-10-01',
                        roomRevenueMinor: 0,
                        roomsSold: 0,
                        roomsAvailable: 2,
                        occupancyPct: 0,
                        adrMinor: 0,
                        revparMinor: 0,
                      },
                    ],
                    paymentsByMethod: [],
                  }
                : { property: { id: 'prop-1', name: 'Seaside Villa' } },
            ),
        } as Response),
      ),
    );

    renderAt('/app/properties/prop-1/reports', 'authenticated');

    expect(
      await screen.findByRole('heading', { name: 'Revenue & occupancy — Seaside Villa' }),
    ).toBeInTheDocument();
  });

  it('sends an anonymous visitor to login instead of the report', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response));

    renderAt('/app/properties/prop-1/reports', 'anonymous');

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Revenue/ })).not.toBeInTheDocument();
  });
});

describe('AppRouter — point of sale route', () => {
  it('renders the till at /app/properties/:propertyId/pos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              url.includes('/pos/outlets')
                ? { outlets: [], page: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } }
                : url.includes('/pos/orders')
                  ? { orders: [], page: { page: 1, pageSize: 15, totalItems: 0, totalPages: 0 } }
                  : { property: { id: 'prop-1', name: 'Seaside Villa' } },
            ),
        } as Response),
      ),
    );

    renderAt('/app/properties/prop-1/pos', 'authenticated');

    expect(await screen.findByRole('heading', { name: 'Point of sale — Seaside Villa' })).toBeInTheDocument();
  });

  it('sends an anonymous visitor to login instead of the till', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response));

    renderAt('/app/properties/prop-1/pos', 'anonymous');

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Point of sale/ })).not.toBeInTheDocument();
  });
});
