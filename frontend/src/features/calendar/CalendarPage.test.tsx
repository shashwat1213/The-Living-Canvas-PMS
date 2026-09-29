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
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    if (url.includes('/assignable-rooms')) {
      return Promise.resolve(
        jsonResponse({
          rooms: [
            { id: 'room-101', name: '101', floor: '1', available: true },
            { id: 'room-102', name: '102', floor: '1', available: false },
          ],
        }),
      );
    }
    if (url.includes('/assign-room')) {
      return Promise.resolve(jsonResponse({ reservation: { id: 'resv-2', roomId: 'room-101' } }));
    }
    if (url.includes('/reschedule')) {
      return Promise.resolve(jsonResponse({ reservation: { id: 'resv-1' } }));
    }
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

  it('lets a manager assign a room to an unassigned booking from the board', async () => {
    const fetchMock = stubApi();
    renderPage(manageSession());

    // Open the unassigned booking's detail popover.
    const bar = await screen.findByRole('button', { name: /Alan Turing/ });
    fireEvent.click(bar);
    const dialog = await screen.findByRole('dialog', { name: 'Reservation details' });
    expect(within(dialog).getByText('Not yet assigned')).toBeInTheDocument();

    // Start assignment → assignable rooms load into a select.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign a room' }));
    const select = await within(dialog).findByRole('combobox');
    // Only the free room is selectable; the occupied one is disabled.
    expect(within(dialog).getByRole('option', { name: /101/ })).not.toBeDisabled();
    expect(within(dialog).getByRole('option', { name: /102.*occupied/ })).toBeDisabled();
    expect((select as HTMLSelectElement).value).toBe('room-101');

    // Confirm → assign-room is POSTed, then the calendar refetches.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/assign-room'))).toBe(true);
    });
  });

  it('does not offer room assignment to a read-only viewer', async () => {
    stubApi();
    renderPage(readOnlySession());

    // Read-only viewers get static bars, so there is no clickable unassigned bar
    // to open — and thus no assignment affordance anywhere on the page.
    await screen.findByText('Alan Turing');
    expect(screen.queryByRole('button', { name: 'Assign a room' })).not.toBeInTheDocument();
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

  it('reassigns a booking when its bar is dragged onto another room of the same type', async () => {
    const fetchMock = stubApi();
    renderPage(manageSession());

    // The assigned booking's bar is draggable for a manager.
    const bar = await screen.findByRole('button', { name: /Ada Lovelace/ });
    expect(bar).toHaveAttribute('draggable', 'true');

    // Room 102 (same type, different room) is the drop target.
    const room102Lane = (screen.getByText('102').closest('.cal-group-contents') as HTMLElement).querySelector(
      '.cal-lane',
    ) as HTMLElement;
    expect(room102Lane).not.toBeNull();

    // Simulate the HTML5 drag: start on the bar, drop on room 102's lane.
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), dropEffect: '', effectAllowed: '' };
    fireEvent.dragStart(bar, { dataTransfer });
    fireEvent.dragOver(room102Lane, { dataTransfer });
    fireEvent.drop(room102Lane, { dataTransfer });

    // assign-room is POSTed for the dragged booking to room-102.
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/resv-1/assign-room'));
      expect(call).toBeTruthy();
    });
    // Success toast surfaces.
    expect(await screen.findByRole('status')).toHaveTextContent(/Ada Lovelace → room 102/);
  });

  it('does not make bars draggable for a read-only viewer', async () => {
    stubApi();
    renderPage(readOnlySession());

    await screen.findByText('Ada Lovelace');
    // Read-only bars are static divs, not draggable buttons.
    expect(screen.queryByRole('button', { name: /Ada Lovelace/ })).not.toBeInTheDocument();
  });

  it('exposes resize handles on a manager-editable bar', async () => {
    stubApi();
    renderPage(manageSession());

    await screen.findByText('Ada Lovelace');
    // A manager-editable assigned bar carries start + end resize handles.
    expect(document.querySelector('.cal-bar-handle-start')).not.toBeNull();
    expect(document.querySelector('.cal-bar-handle-end')).not.toBeNull();
  });

  it('reschedules a stay when a manager drags the end edge outward', async () => {
    const fetchMock = stubApi();
    renderPage(manageSession());

    await screen.findByText('Ada Lovelace');
    // Target the assigned booking's own bar (Ada / resv-1), not the first bar
    // on the board (which is the unassigned Alan Turing).
    const adaBar = screen.getByText('Ada Lovelace').closest('.cal-bar') as HTMLElement;
    const endHandle = adaBar.querySelector('.cal-bar-handle-end') as HTMLElement;
    expect(endHandle).not.toBeNull();

    // Simulate dragging the end edge ~2 night-columns to the right (44px each).
    fireEvent.pointerDown(endHandle, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 188 });
    fireEvent.pointerUp(window, { clientX: 188 });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/resv-1/reschedule'));
      expect(call).toBeTruthy();
    });
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/resv-1/reschedule'))!;
    const body = JSON.parse((call as unknown as [string, RequestInit])[1].body as string);
    expect(body.checkIn).toBe('2026-10-01');
    // Original checkout 2026-10-03 + 2 nights = 2026-10-05.
    expect(body.checkOut).toBe('2026-10-05');
  });

  it('does not expose resize handles to a read-only viewer', async () => {
    stubApi();
    renderPage(readOnlySession());

    await screen.findByText('Ada Lovelace');
    expect(document.querySelector('.cal-bar-handle')).toBeNull();
  });
});
