import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import { GroupsPage } from './GroupsPage';
import type { ReservationGroupDetail, ReservationGroupSummary } from './types';

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

const summary: ReservationGroupSummary = {
  id: 'grp-1',
  name: 'Sharma Wedding',
  reference: 'BLK-AAA111',
  notes: 'Weekend block',
  createdAt: '2026-09-01T00:00:00.000Z',
  roomCount: 3,
  contactGuest: { id: 'g-1', firstName: 'Ravi', lastName: 'Sharma' },
};

const detail: ReservationGroupDetail = {
  id: 'grp-1',
  name: 'Sharma Wedding',
  reference: 'BLK-AAA111',
  notes: 'Weekend block',
  createdAt: '2026-09-01T00:00:00.000Z',
  contactGuest: { id: 'g-1', firstName: 'Ravi', lastName: 'Sharma', email: null, phone: null },
  totalAmountMinor: 4050000,
  reservations: [
    {
      id: 'r-1',
      reference: 'LC-AAA111',
      status: 'CONFIRMED',
      guest: { id: 'g-1', firstName: 'Ravi', lastName: 'Sharma' },
      roomType: { id: 'rt-1', name: 'Deluxe King', code: 'DLX' },
      room: null,
      checkIn: '2026-10-10',
      checkOut: '2026-10-13',
      totalAmountMinor: 1350000,
    },
    {
      id: 'r-2',
      reference: 'LC-BBB222',
      status: 'CONFIRMED',
      guest: { id: 'g-2', firstName: 'Priya', lastName: 'Sharma' },
      roomType: { id: 'rt-1', name: 'Deluxe King', code: 'DLX' },
      room: { id: 'room-101', name: '101' },
      checkIn: '2026-10-10',
      checkOut: '2026-10-13',
      totalAmountMinor: 1350000,
    },
  ],
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function stubApi(groups: ReservationGroupSummary[] = [summary]) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/reservation-groups/grp-1/cancel')) {
      return Promise.resolve(
        jsonResponse({ group: { ...detail, reservations: detail.reservations.map((r) => ({ ...r, status: 'CANCELLED' })) } }),
      );
    }
    if (url.includes('/reservation-groups/grp-1')) {
      return Promise.resolve(jsonResponse({ group: detail }));
    }
    if (url.includes('/reservation-groups')) {
      return Promise.resolve(jsonResponse({ groups }));
    }
    if (url.includes('/guests')) {
      return Promise.resolve(jsonResponse({ guests: [], page: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } }));
    }
    if (url.includes('/room-types')) {
      return Promise.resolve(jsonResponse({ roomTypes: [], page: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } }));
    }
    if (url.includes('/rate-plans')) {
      return Promise.resolve(jsonResponse({ ratePlans: [], page: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } }));
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
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/blocks`]}>
        <Routes>
          <Route path="/app/properties/:propertyId/blocks" element={<GroupsPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GroupsPage', () => {
  it('lists blocks with their room count', async () => {
    stubApi();
    renderPage(readOnlySession());

    expect(await screen.findByText('Sharma Wedding')).toBeInTheDocument();
    expect(screen.getByText('BLK-AAA111')).toBeInTheDocument();
    expect(screen.getByText('3 rooms')).toBeInTheDocument();
  });

  it('shows the empty state when there are no blocks', async () => {
    stubApi([]);
    renderPage(readOnlySession());

    expect(await screen.findByText(/No blocks yet/)).toBeInTheDocument();
  });

  it('opens a block detail drawer with its rooms', async () => {
    stubApi();
    renderPage(readOnlySession());

    fireEvent.click(await screen.findByText('Sharma Wedding'));

    const dialog = await screen.findByRole('dialog', { name: 'Block details' });
    expect(within(dialog).getByText('Ravi Sharma')).toBeInTheDocument();
    expect(within(dialog).getByText('Priya Sharma')).toBeInTheDocument();
    // The assigned room shows on the second line.
    expect(within(dialog).getByText(/Room 101/)).toBeInTheDocument();
  });

  it('lets a manager create a block via the dialog', async () => {
    stubApi([]);
    renderPage(manageSession());

    await screen.findByText(/No blocks yet/);
    fireEvent.click(screen.getByRole('button', { name: 'New block' }));

    expect(await screen.findByRole('dialog', { name: 'New block booking' })).toBeInTheDocument();
  });

  it('hides the New block button from a read-only viewer', async () => {
    stubApi();
    renderPage(readOnlySession());

    await screen.findByText('Sharma Wedding');
    expect(screen.queryByRole('button', { name: 'New block' })).not.toBeInTheDocument();
  });

  it('cancels a block from the detail drawer', async () => {
    const fetchMock = stubApi();
    renderPage(manageSession());

    fireEvent.click(await screen.findByText('Sharma Wedding'));
    const dialog = await screen.findByRole('dialog', { name: 'Block details' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel block/ }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/reservation-groups/grp-1/cancel'))).toBe(true);
    });
  });

  it('gates the page without reservations:read', async () => {
    stubApi();
    renderPage(noAccessSession());

    expect(await screen.findByText(/don't have access to reservations/i)).toBeInTheDocument();
    expect(screen.queryByText('Sharma Wedding')).not.toBeInTheDocument();
  });
});
