import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import { CalendarPage } from './CalendarPage';
import type { CalendarResponse } from './types';

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

const manageSession = () => session(['properties:read', 'reservations:read', 'reservations:manage']);
const readOnlySession = () => session(['properties:read', 'reservations:read']);
const noAccessSession = () => session(['properties:read']);

/**
 * A 4-night window with two room types. Room 101 has an assigned in-house
 * stay; one booking sits unassigned; room 202 is out of service.
 */
function calendar(overrides: Partial<CalendarResponse> = {}): CalendarResponse {
  return {
    from: '2026-10-01',
    to: '2026-10-05',
    dates: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'],
    roomTypes: [
      {
        id: 'rt-1',
        name: 'Deluxe King',
        code: 'DLX',
        rooms: [
          { id: 'room-101', name: '101', floor: '1', status: 'ACTIVE', housekeepingStatus: 'INSPECTED' },
          { id: 'room-102', name: '102', floor: '1', status: 'ACTIVE', housekeepingStatus: 'DIRTY' },
        ],
      },
      {
        id: 'rt-2',
        name: 'Standard Twin',
        code: null,
        rooms: [{ id: 'room-202', name: '202', floor: '2', status: 'MAINTENANCE', housekeepingStatus: 'CLEAN' }],
      },
    ],
    assigned: {
      'room-101': [
        {
          id: 'resv-1',
          reference: 'LC-AAA111',
          status: 'CHECKED_IN',
          roomId: 'room-101',
          roomTypeId: 'rt-1',
          guestName: 'Ada Lovelace',
          adults: 2,
          children: 0,
          checkIn: '2026-10-01',
          checkOut: '2026-10-03',
          startIndex: 0,
          span: 2,
          continuesBefore: false,
          continuesAfter: false,
        },
      ],
    },
    unassigned: [
      {
        id: 'resv-2',
        reference: 'LC-BBB222',
        status: 'CONFIRMED',
        roomId: null,
        roomTypeId: 'rt-1',
        guestName: 'Alan Turing',
        adults: 1,
        children: 1,
        checkIn: '2026-10-02',
        checkOut: '2026-10-05',
        startIndex: 1,
        span: 3,
        continuesBefore: false,
        continuesAfter: false,
      },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function stubApi(response?: CalendarResponse) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/calendar')) {
      return Promise.resolve(jsonResponse(response ?? calendar()));
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
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/calendar`]}>
        <Routes>
          <Route path="/app/properties/:propertyId/calendar" element={<CalendarPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CalendarPage', () => {
  it('renders room-type groups with their rooms and the property name', async () => {
    stubApi();
    renderPage(readOnlySession());

    expect(
      await screen.findByRole('heading', { name: 'Reservation calendar — Seaside Villa' }),
    ).toBeInTheDocument();

    // Room-type group headings.
    expect(screen.getByText('Deluxe King')).toBeInTheDocument();
    expect(screen.getByText('Standard Twin')).toBeInTheDocument();
    // Rooms appear as row headers.
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getByText('102')).toBeInTheDocument();
    expect(screen.getByText('202')).toBeInTheDocument();
  });

  it('shows an assigned booking as a bar under its room', async () => {
    stubApi();
    renderPage(readOnlySession());

    // The assigned stay's guest + reference render.
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('LC-AAA111')).toBeInTheDocument();
  });

  it('lists an unassigned booking in the unassigned lane', async () => {
    stubApi();
    renderPage(readOnlySession());

    expect(await screen.findByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('1 awaiting a room')).toBeInTheDocument();
    expect(screen.getByText('Alan Turing')).toBeInTheDocument();
  });

  it('marks an out-of-service room in its metadata', async () => {
    stubApi();
    renderPage(readOnlySession());

    const room202Head = (await screen.findByText('202')).closest('.cal-rowhead');
    expect(room202Head).not.toBeNull();
    expect(within(room202Head as HTMLElement).getByText(/Maintenance/)).toBeInTheDocument();
    expect((room202Head as HTMLElement).className).toContain('cal-rowhead-oos');
  });

  it('makes bars clickable and opens a detail dialog for a manager', async () => {
    stubApi();
    renderPage(manageSession());

    const bar = await screen.findByRole('button', { name: /Ada Lovelace/ });
    fireEvent.click(bar);

    const dialog = await screen.findByRole('dialog', { name: 'Reservation details' });
    expect(within(dialog).getByText('LC-AAA111')).toBeInTheDocument();
    expect(within(dialog).getByText('In-house')).toBeInTheDocument();
    expect(within(dialog).getByText('2026-10-01 → 2026-10-03')).toBeInTheDocument();
  });

  it('renders bars as non-interactive (no buttons) for a read-only viewer', async () => {
    stubApi();
    renderPage(readOnlySession());

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    // Read-only: the guest label is not a clickable button.
    expect(screen.queryByRole('button', { name: /Ada Lovelace/ })).not.toBeInTheDocument();
  });

  it('gates the page when the viewer lacks reservations:read', async () => {
    stubApi();
    renderPage(noAccessSession());

    expect(await screen.findByText(/don't have access to reservations/i)).toBeInTheDocument();
    expect(screen.queryByText('Deluxe King')).not.toBeInTheDocument();
  });

  it('shifts the window forward and refetches', async () => {
    const fetchMock = stubApi();
    renderPage(readOnlySession());

    await screen.findByText('Deluxe King');
    const before = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/calendar')).length;

    fireEvent.click(screen.getByRole('button', { name: /Forward/ }));

    await waitFor(() => {
      const after = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/calendar')).length;
      expect(after).toBeGreaterThan(before);
    });
  });
});
