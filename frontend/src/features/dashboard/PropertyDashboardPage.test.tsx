import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import { PropertyDashboardPage } from './PropertyDashboardPage';
import type { DashboardView } from './types';

const PROPERTY_ID = 'prop-1';

function makeToken(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function session(permissions: string[]) {
  return readSessionClaims(
    makeToken({
      sub: 'user-1',
      organizationId: 'org-1',
      permissions,
      roleNames: ['OWNER'],
      grantedPropertyIds: [PROPERTY_ID],
    }),
  );
}

const readSession = () => session(['properties:read', 'dashboard:read']);
const noAccessSession = () => session(['properties:read']);

function dashboardView(overrides: Partial<DashboardView> = {}): DashboardView {
  return {
    date: '2026-10-10',
    summary: {
      arrivals: 1,
      departures: 1,
      inHouse: 2,
      occupancyPct: 40,
      sellableRooms: 5,
      occupiedRooms: 2,
      roomsToClean: 3,
      roomsOutOfService: 1,
      openWorkOrders: 2,
      urgentWorkOrders: 1,
      unsettledFolios: 1,
      unsettledBalanceMinor: 950000,
    },
    arrivals: [
      {
        id: 'r-arr',
        reference: 'LC-100',
        status: 'CONFIRMED',
        guest: { id: 'g1', firstName: 'Ada', lastName: 'Lovelace' },
        roomType: { id: 'rt1', name: 'Deluxe King' },
        room: null,
        checkIn: '2026-10-10',
        checkOut: '2026-10-12',
      },
    ],
    departures: [
      {
        id: 'r-dep',
        reference: 'LC-090',
        status: 'CHECKED_IN',
        guest: { id: 'g2', firstName: 'Grace', lastName: 'Hopper' },
        roomType: { id: 'rt1', name: 'Deluxe King' },
        room: { id: 'rm1', name: '101' },
        checkIn: '2026-10-08',
        checkOut: '2026-10-10',
      },
    ],
    inHouse: [
      {
        id: 'r-in1',
        reference: 'LC-085',
        status: 'CHECKED_IN',
        guest: { id: 'g3', firstName: 'Alan', lastName: 'Turing' },
        roomType: { id: 'rt2', name: 'Standard Twin' },
        room: { id: 'rm2', name: '102' },
        checkIn: '2026-10-09',
        checkOut: '2026-10-11',
      },
      {
        id: 'r-in2',
        reference: 'LC-086',
        status: 'CHECKED_IN',
        guest: { id: 'g4', firstName: 'Edsger', lastName: 'Dijkstra' },
        roomType: { id: 'rt2', name: 'Standard Twin' },
        room: { id: 'rm3', name: '103' },
        checkIn: '2026-10-09',
        checkOut: '2026-10-13',
      },
    ],
    housekeeping: { dirty: 2, cleaning: 1, clean: 4, inspected: 3, openTasks: 5 },
    maintenance: { open: 2, urgent: 1, roomsOutOfService: 1 },
    unsettledFolioList: [
      { id: 'f1', reference: 'LC-085', guestName: 'Alan Turing', balanceMinor: 950000 },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function stubApi(
  options: { response?: DashboardView; onDashboard?: (url: string) => void } = {},
) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/dashboard')) {
      options.onDashboard?.(url);
      return Promise.resolve(jsonResponse(options.response ?? dashboardView()));
    }
    return Promise.resolve(jsonResponse({ property: { id: PROPERTY_ID, name: 'Seaside Villa' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(sessionValue: AuthContextValue['session']) {
  const value: AuthContextValue = {
    status: 'authenticated',
    session: sessionValue,
    login: vi.fn(),
    logout: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/dashboard`]}>
        <Routes>
          <Route path="/app/properties/:propertyId/dashboard" element={<PropertyDashboardPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PropertyDashboardPage', () => {
  it('renders the KPI strip with headline counters', async () => {
    stubApi();
    renderPage(readSession());

    expect(await screen.findByRole('heading', { name: 'Dashboard — Seaside Villa' })).toBeInTheDocument();

    // Occupancy shown as a percentage with its rooms hint.
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('2 of 5 rooms')).toBeInTheDocument();
    // Unsettled balance formatted from paise (₹9,500 compact) appears in the
    // KPI strip hint and again in the folio panel — assert at least one.
    expect(screen.getAllByText(/₹9,500/).length).toBeGreaterThan(0);
  });

  it('lists arrivals, departures and in-house guests', async () => {
    stubApi();
    renderPage(readSession());

    const arrivals = (await screen.findByRole('heading', { name: 'Arrivals' })).closest('.cockpit-list') as HTMLElement;
    expect(within(arrivals).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(arrivals).getByText(/LC-100 · Deluxe King/)).toBeInTheDocument();

    const inHouse = screen.getByRole('heading', { name: 'In-house' }).closest('.cockpit-list') as HTMLElement;
    expect(within(inHouse).getByText('Alan Turing')).toBeInTheDocument();
    expect(within(inHouse).getByText('Edsger Dijkstra')).toBeInTheDocument();
  });

  it('shows the unsettled folio with its balance', async () => {
    stubApi();
    renderPage(readSession());

    const panel = (await screen.findByRole('heading', { name: 'Unsettled folios' })).closest(
      '.cockpit-panel',
    ) as HTMLElement;
    expect(within(panel).getByText('Alan Turing')).toBeInTheDocument();
    expect(within(panel).getByText(/₹9,500/)).toBeInTheDocument();
  });

  it('requests the previous day when the back arrow is clicked', async () => {
    const urls: string[] = [];
    stubApi({ onDashboard: (url) => urls.push(url) });
    renderPage(readSession());

    // Wait for the first (today) load.
    await screen.findByRole('heading', { name: 'Dashboard — Seaside Villa' });
    const firstCount = urls.length;

    fireEvent.click(screen.getByLabelText('Previous day'));

    // A new request goes out with an explicit, earlier date param.
    await waitFor(() => expect(urls.length).toBeGreaterThan(firstCount));
    const last = urls[urls.length - 1];
    expect(last).toMatch(/[?&]date=\d{4}-\d{2}-\d{2}/);
  });

  it('shows an empty message for a day with no arrivals', async () => {
    stubApi({
      response: dashboardView({
        arrivals: [],
        summary: { ...dashboardView().summary, arrivals: 0 },
      }),
    });
    renderPage(readSession());

    const arrivals = (await screen.findByRole('heading', { name: 'Arrivals' })).closest('.cockpit-list') as HTMLElement;
    expect(within(arrivals).getByText('No arrivals for this day.')).toBeInTheDocument();
  });

  it('gates the screen behind dashboard:read (presentation only)', async () => {
    const fetchMock = stubApi();
    renderPage(noAccessSession());

    expect(await screen.findByText(/don't have access to this property's dashboard/i)).toBeInTheDocument();
    // No dashboard request is made when the permission is absent.
    const dashboardCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/dashboard'));
    expect(dashboardCalls).toHaveLength(0);
  });
});
