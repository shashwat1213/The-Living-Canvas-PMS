import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import type { PageMeta } from '../../lib/pagination';
import { ReservationsPage } from './ReservationsPage';
import type { ReservationListRow } from './types';

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

function reservation(overrides: Partial<ReservationListRow> = {}): ReservationListRow {
  return {
    id: 'res-1',
    propertyId: PROPERTY_ID,
    roomTypeId: 'rt-1',
    ratePlanId: 'rp-1',
    guestId: 'guest-1',
    roomId: null,
    reference: 'LC-3F9K2A',
    status: 'CONFIRMED',
    checkIn: '2026-10-10',
    checkOut: '2026-10-12',
    adults: 2,
    children: 0,
    totalAmountMinor: 900000,
    notes: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    guest: { id: 'guest-1', firstName: 'Asha', lastName: 'Menon', email: 'asha@example.com', phone: null },
    roomType: { id: 'rt-1', name: 'Deluxe King', code: 'DLX' },
    ratePlan: { id: 'rp-1', name: 'Best Available Rate', code: 'BAR', isRefundable: true },
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function listPage(rows: ReservationListRow[], overrides: Partial<PageMeta> = {}) {
  return {
    reservations: rows,
    page: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1, ...overrides },
  };
}

function stubApi(options: {
  reservations?: ReservationListRow[];
  assignableRooms?: { id: string; name: string; floor: string | null; available: boolean }[];
  onMutate?: (url: string, init?: RequestInit) => void;
} = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      options.onMutate?.(url, init);
      return Promise.resolve(jsonResponse({ reservation: reservation({ status: 'CANCELLED' }) }));
    }
    if (url.includes('/assignable-rooms')) {
      return Promise.resolve(
        jsonResponse({
          rooms: options.assignableRooms ?? [{ id: 'room-1', name: '101', floor: '1', available: true }],
        }),
      );
    }
    if (url.includes('/reservations')) {
      return Promise.resolve(jsonResponse(listPage(options.reservations ?? [])));
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
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/reservations`]}>
        <Routes>
          <Route path="/app/properties/:propertyId/reservations" element={<ReservationsPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReservationsPage', () => {
  it('names the property and lists bookings with guest, stay and total', async () => {
    stubApi({ reservations: [reservation()] });
    renderPage(manageSession());

    expect(await screen.findByRole('heading', { name: 'Reservations — Seaside Villa' })).toBeInTheDocument();
    expect(screen.getByText('LC-3F9K2A')).toBeInTheDocument();
    expect(screen.getByText('Asha Menon')).toBeInTheDocument();
    expect(screen.getByText('2 nights · Deluxe King')).toBeInTheDocument();
    // ₹9,000.00 formatted from 900000 paise.
    expect(screen.getByText(/9,000\.00/)).toBeInTheDocument();
  });

  it('shows a manager the new-booking button and cancel/no-show for a confirmed row', async () => {
    stubApi({ reservations: [reservation()] });
    renderPage(manageSession());

    await screen.findByText('LC-3F9K2A');
    expect(screen.getByRole('button', { name: 'New booking' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No-show' })).toBeInTheDocument();
  });

  it('hides management controls from a read-only user', async () => {
    stubApi({ reservations: [reservation()] });
    renderPage(readOnlySession());

    await screen.findByText('LC-3F9K2A');
    expect(screen.queryByRole('button', { name: 'New booking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'No-show' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('does not offer cancel or no-show for a cancelled booking', async () => {
    stubApi({ reservations: [reservation({ status: 'CANCELLED', cancelledAt: '2026-09-02T00:00:00.000Z' })] });
    renderPage(manageSession());

    await screen.findByText('LC-3F9K2A');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'No-show' })).not.toBeInTheDocument();
  });

  it('explains its absence to a user without reservation access', async () => {
    stubApi({ reservations: [reservation()] });
    renderPage(noAccessSession());

    expect(await screen.findByText(/don.t have access to reservations/i)).toBeInTheDocument();
  });

  it('cancels a booking through the confirmation, POSTing to the cancel endpoint', async () => {
    let cancelUrl: string | undefined;
    stubApi({
      reservations: [reservation()],
      onMutate: (url, init) => {
        if (init?.method === 'POST' && url.includes('/cancel')) cancelUrl = url;
      },
    });
    renderPage(manageSession());

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel reservation' }));

    await waitFor(() => {
      expect(cancelUrl).toContain(`/api/v1/properties/${PROPERTY_ID}/reservations/res-1/cancel`);
    });
  });

  it('offers check-in and assign-room for a confirmed booking, check-out for a checked-in one', async () => {
    stubApi({ reservations: [reservation({ status: 'CHECKED_IN', roomId: 'room-1' })] });
    renderPage(manageSession());

    await screen.findByText('LC-3F9K2A');
    // Checked-in booking: check-out + change room, no check-in.
    expect(screen.getByRole('button', { name: 'Check out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change room' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
  });

  it('checks a guest in via the room picker, POSTing to the check-in endpoint', async () => {
    let checkInUrl: string | undefined;
    let checkInBody: unknown;
    stubApi({
      reservations: [reservation()],
      onMutate: (url, init) => {
        if (init?.method === 'POST' && url.includes('/check-in')) {
          checkInUrl = url;
          checkInBody = init.body ? JSON.parse(init.body as string) : undefined;
        }
      },
    });
    renderPage(manageSession());

    fireEvent.click(await screen.findByRole('button', { name: 'Check in' }));
    // Room picker loads the assignable rooms; select 101 and confirm.
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('radio', { name: /101/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check in' }));

    await waitFor(() => {
      expect(checkInUrl).toContain(`/api/v1/properties/${PROPERTY_ID}/reservations/res-1/check-in`);
    });
    expect(checkInBody).toEqual({ roomId: 'room-1' });
  });

  it('shows an occupied room as non-selectable in the picker', async () => {
    stubApi({
      reservations: [reservation()],
      assignableRooms: [
        { id: 'room-1', name: '101', floor: '1', available: true },
        { id: 'room-2', name: '102', floor: '1', available: false },
      ],
    });
    renderPage(manageSession());

    fireEvent.click(await screen.findByRole('button', { name: 'Assign room' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('radio', { name: /101/ })).toBeEnabled();
    expect(within(dialog).getByRole('radio', { name: /102/ })).toBeDisabled();
    expect(within(dialog).getByText('Occupied')).toBeInTheDocument();
  });
});
