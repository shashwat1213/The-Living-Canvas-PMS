import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import { AvailabilityPage } from './AvailabilityPage';
import type { AvailabilityResponse } from './types';

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

const readSession = () => session(['properties:read', 'reservations:read']);
const noAccessSession = () => session(['properties:read']);

/**
 * A 3-night window (2026-10-01 .. 2026-10-04 exclusive) with one open room
 * type and one that sells out on the middle night.
 */
function availability(overrides: Partial<AvailabilityResponse> = {}): AvailabilityResponse {
  return {
    from: '2026-10-01',
    to: '2026-10-04',
    dates: ['2026-10-01', '2026-10-02', '2026-10-03'],
    roomTypes: [
      {
        id: 'rt-1',
        name: 'Deluxe King',
        code: 'DLX',
        totalRooms: 3,
        days: [
          { date: '2026-10-01', booked: 1, available: 2 },
          { date: '2026-10-02', booked: 3, available: 0 },
          { date: '2026-10-03', booked: 0, available: 3 },
        ],
      },
      {
        id: 'rt-2',
        name: 'Standard Twin',
        code: null,
        totalRooms: 2,
        days: [
          { date: '2026-10-01', booked: 0, available: 2 },
          { date: '2026-10-02', booked: 1, available: 1 },
          { date: '2026-10-03', booked: 0, available: 2 },
        ],
      },
    ],
    totals: {
      days: [
        { date: '2026-10-01', totalRooms: 5, booked: 1, available: 4, occupancyPct: 20 },
        { date: '2026-10-02', totalRooms: 5, booked: 4, available: 1, occupancyPct: 80 },
        { date: '2026-10-03', totalRooms: 5, booked: 0, available: 5, occupancyPct: 0 },
      ],
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function stubApi(options: {
  response?: AvailabilityResponse;
  onAvailability?: (url: string) => void;
} = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/availability')) {
      options.onAvailability?.(url);
      return Promise.resolve(jsonResponse(options.response ?? availability()));
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
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/availability`]}>
        <Routes>
          <Route path="/app/properties/:propertyId/availability" element={<AvailabilityPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AvailabilityPage', () => {
  it('renders the grid with room-type rows and per-night available counts', async () => {
    stubApi();
    renderPage(readSession());

    expect(await screen.findByRole('heading', { name: 'Availability — Seaside Villa' })).toBeInTheDocument();

    // Room-type rows are present, with code + totalRooms metadata.
    const deluxeRow = screen.getByRole('row', { name: /Deluxe King/ });
    expect(within(deluxeRow).getByText(/DLX · 3 rooms/)).toBeInTheDocument();
    // Its per-night free counts: 2, 0, 3.
    const deluxeCells = within(deluxeRow).getAllByRole('cell');
    expect(deluxeCells.map((c) => c.textContent)).toEqual(['2', '0', '3']);

    const twinRow = screen.getByRole('row', { name: /Standard Twin/ });
    expect(within(twinRow).getByText(/2 rooms/)).toBeInTheDocument();
  });

  it('marks a sold-out night (available 0) with its distinct state', async () => {
    stubApi();
    renderPage(readSession());

    const deluxeRow = await screen.findByRole('row', { name: /Deluxe King/ });
    const cells = within(deluxeRow).getAllByRole('cell');
    // Middle night is sold out; the other two are open.
    expect(cells[0].className).toContain('availability-cell-open');
    expect(cells[1].className).toContain('availability-cell-soldout');
    expect(cells[1]).toHaveAttribute('title', '0 of 3 free');
    expect(cells[2].className).toContain('availability-cell-open');
  });

  it('shows occupancyPct per night from totals', async () => {
    stubApi();
    renderPage(readSession());

    await screen.findByRole('heading', { name: 'Availability — Seaside Villa' });
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('advances the window a week on Next, refetching with an advanced from/to', async () => {
    const urls: string[] = [];
    stubApi({ onAvailability: (url) => urls.push(url) });
    renderPage(readSession());

    await screen.findByRole('heading', { name: 'Availability — Seaside Villa' });
    const firstUrl = urls[0];
    // Default window is today .. today+7.
    const firstFrom = new URL(firstUrl, 'http://x').searchParams.get('from')!;
    const firstTo = new URL(firstUrl, 'http://x').searchParams.get('to')!;

    fireEvent.click(screen.getByRole('button', { name: /Next week/ }));

    await waitFor(() => expect(urls.length).toBeGreaterThan(1));
    const lastUrl = urls[urls.length - 1];
    const nextFrom = new URL(lastUrl, 'http://x').searchParams.get('from')!;
    const nextTo = new URL(lastUrl, 'http://x').searchParams.get('to')!;

    const addDays = (d: string, n: number) =>
      new Date(Date.parse(`${d}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
    expect(nextFrom).toBe(addDays(firstFrom, 7));
    expect(nextTo).toBe(addDays(firstTo, 7));
  });

  it('explains its absence to a user without reservations:read, showing no grid', async () => {
    stubApi();
    renderPage(noAccessSession());

    expect(await screen.findByText(/don.t have access to availability/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
