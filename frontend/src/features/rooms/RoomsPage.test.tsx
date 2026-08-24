import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import type { PageMeta } from '../../lib/pagination';
import { RoomsPage } from './RoomsPage';
import type { Room } from './types';

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

const managerSession = () =>
  session(['properties:read', 'rooms:read', 'rooms:create', 'rooms:update', 'rooms:delete']);
const readOnlySession = () => session(['properties:read', 'rooms:read']);

function room(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    propertyId: PROPERTY_ID,
    name: '101',
    roomType: 'Deluxe King',
    // The API returns this on every room since task 2a; null means the
    // room has a label but no structured type assigned yet.
    roomTypeId: null,
    floor: '1',
    capacity: 2,
    status: 'ACTIVE',
    notes: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function roomsPage(rows: Room[], overrides: Partial<PageMeta> = {}) {
  return {
    rooms: rows,
    page: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1, ...overrides },
  };
}

/**
 * The page issues two independent GETs — the room list and the property
 * heading — so the stub routes on the URL rather than call order.
 */
function stubApi(options: {
  rooms?: Room[];
  pageOverrides?: Partial<PageMeta>;
  listError?: { status: number; message: string };
  propertyFails?: boolean;
  onMutate?: (url: string, init?: RequestInit) => void;
  onList?: (url: string) => void;
}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      options.onMutate?.(url, init);
      return Promise.resolve(jsonResponse({ room: room() }));
    }
    if (url.includes('/rooms')) {
      options.onList?.(url);
      if (options.listError) {
        return Promise.resolve(
          jsonResponse(
            { error: { code: 'error', message: options.listError.message } },
            false,
            options.listError.status,
          ),
        );
      }
      return Promise.resolve(jsonResponse(roomsPage(options.rooms ?? [], options.pageOverrides)));
    }
    // The property heading.
    if (options.propertyFails) {
      return Promise.resolve(jsonResponse({ error: { code: 'not_found', message: 'gone' } }, false, 404));
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
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/rooms`]}>
        <Routes>
          <Route path="/app/properties/:propertyId/rooms" element={<RoomsPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const lastUrl = (urls: string[]) => urls[urls.length - 1] ?? '';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RoomsPage — loading, empty and error states', () => {
  it('shows an empty state when the property has no rooms', async () => {
    stubApi({ rooms: [] });
    renderPage(managerSession());

    expect(await screen.findByText('No rooms yet — add your first one above.')).toBeInTheDocument();
  });

  it('names the property in the heading and links back', async () => {
    stubApi({ rooms: [room()] });
    renderPage(managerSession());

    expect(await screen.findByRole('heading', { name: 'Rooms — Seaside Villa' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Properties' })).toHaveAttribute('href', '/app/properties');
  });

  it('links across to the room-type catalogue only with `room-types:read`', async () => {
    stubApi({ rooms: [room()] });
    const { unmount } = renderPage(session(['properties:read', 'rooms:read', 'room-types:read']));

    expect(await screen.findByRole('link', { name: 'Room types' })).toHaveAttribute(
      'href',
      `/app/properties/${PROPERTY_ID}/room-types`,
    );
    unmount();

    stubApi({ rooms: [room()] });
    renderPage(readOnlySession());
    await screen.findByText('101');
    expect(screen.queryByRole('link', { name: 'Room types' })).not.toBeInTheDocument();
  });

  it('still renders the table when the property heading fails to load', async () => {
    // The heading is a separate request; losing it must not take the
    // room list down with it.
    stubApi({ rooms: [room()], propertyFails: true });
    renderPage(managerSession());

    expect(await screen.findByText('101')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rooms' })).toBeInTheDocument();
  });

  it('lists rooms with type, floor and capacity', async () => {
    stubApi({ rooms: [room()] });
    renderPage(managerSession());

    await screen.findByText('101');
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Deluxe King')).toBeInTheDocument();
    expect(table.getByText('1')).toBeInTheDocument();
    expect(table.getByText('2')).toBeInTheDocument();
  });

  it('surfaces the API error message when loading fails', async () => {
    stubApi({ listError: { status: 404, message: 'Property not found.' } });
    renderPage(managerSession());

    expect(await screen.findByRole('alert')).toHaveTextContent('Property not found.');
  });
});

describe('RoomsPage — server-side search and filters', () => {
  it('debounces the search box into a single request', async () => {
    const urls: string[] = [];
    stubApi({ rooms: [room()], onList: (url) => urls.push(url) });
    renderPage(managerSession());
    await screen.findByText('101');
    const before = urls.length;

    const box = screen.getByLabelText('Search');
    fireEvent.change(box, { target: { value: 'd' } });
    fireEvent.change(box, { target: { value: 'del' } });
    fireEvent.change(box, { target: { value: 'deluxe' } });

    expect(urls.length).toBe(before);
    await waitFor(() => expect(lastUrl(urls)).toContain('search=deluxe'));
    expect(urls.length).toBe(before + 1);
  });

  it('sends the status filter to the server', async () => {
    const urls: string[] = [];
    stubApi({ rooms: [room()], onList: (url) => urls.push(url) });
    renderPage(managerSession());
    await screen.findByText('101');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'MAINTENANCE' } });

    await waitFor(() => expect(lastUrl(urls)).toContain('status=MAINTENANCE'));
  });

  it('scopes every request to the property in the route', async () => {
    const urls: string[] = [];
    stubApi({ rooms: [room()], onList: (url) => urls.push(url) });
    renderPage(managerSession());
    await screen.findByText('101');

    expect(lastUrl(urls)).toContain(`/api/v1/properties/${PROPERTY_ID}/rooms`);
  });
});

describe('RoomsPage — pagination', () => {
  it('shows the server position and requests the next page', async () => {
    const urls: string[] = [];
    stubApi({
      rooms: [room(), room({ id: 'room-2', name: '102' })],
      pageOverrides: { pageSize: 2, totalItems: 5, totalPages: 3 },
      onList: (url) => urls.push(url),
    });
    renderPage(managerSession());

    expect(await screen.findByText('1–2 of 5 rooms')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastUrl(urls)).toContain('page=2'));
  });

  it('uses the correct singular for a single room', async () => {
    stubApi({ rooms: [room()] });
    renderPage(managerSession());

    expect(await screen.findByText('1 room')).toBeInTheDocument();
  });
});

describe('RoomsPage — permission gating (presentation only)', () => {
  it('hides create, edit, delete and the inline status control from a read-only caller', async () => {
    stubApi({ rooms: [room()] });
    renderPage(readOnlySession());

    await screen.findByText('101');
    expect(screen.queryByRole('button', { name: 'Add room' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // Status falls back to a read-only badge rather than a select.
    expect(screen.queryByLabelText('Status for room 101')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Active')).toBeInTheDocument();
  });
});

describe('RoomsPage — mutations', () => {
  it('changes status inline with PATCH', async () => {
    const mutations: { url: string; method?: string; body: Record<string, unknown> }[] = [];
    stubApi({
      rooms: [room()],
      onMutate: (url, init) =>
        mutations.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> }),
    });
    renderPage(managerSession());
    await screen.findByText('101');

    fireEvent.change(screen.getByLabelText('Status for room 101'), { target: { value: 'MAINTENANCE' } });

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('PATCH');
    expect(mutations[0]?.url).toContain(`/api/v1/properties/${PROPERTY_ID}/rooms/room-1`);
    expect(mutations[0]?.body).toEqual({ status: 'MAINTENANCE' });
  });

  it('validates capacity before sending anything', async () => {
    const mutations: unknown[] = [];
    stubApi({ rooms: [], onMutate: () => mutations.push(true) });
    renderPage(managerSession());
    await screen.findByText('No rooms yet — add your first one above.');

    fireEvent.click(screen.getByRole('button', { name: 'Add room' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '303' } });
    fireEvent.change(within(dialog).getByLabelText('Room type'), { target: { value: 'Suite' } });
    fireEvent.change(within(dialog).getByLabelText('Capacity'), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add room' }));

    expect(await within(dialog).findByText(/Capacity must be a whole number/i)).toBeInTheDocument();
    expect(mutations).toHaveLength(0);
  });

  it('creates a room using the real contract', async () => {
    const mutations: { url: string; method?: string; body: Record<string, unknown> }[] = [];
    stubApi({
      rooms: [],
      onMutate: (url, init) =>
        mutations.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> }),
    });
    renderPage(managerSession());
    await screen.findByText('No rooms yet — add your first one above.');

    fireEvent.click(screen.getByRole('button', { name: 'Add room' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '303' } });
    fireEvent.change(within(dialog).getByLabelText('Room type'), { target: { value: 'Suite' } });
    fireEvent.change(within(dialog).getByLabelText('Capacity'), { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add room' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('POST');
    expect(mutations[0]?.body).toMatchObject({ name: '303', roomType: 'Suite', capacity: 4, status: 'ACTIVE' });
    // Blank optional fields are omitted, not sent as empty strings.
    expect(mutations[0]?.body).not.toHaveProperty('notes');
  });

  it('confirms before deleting, and sends nothing if cancelled', async () => {
    const mutations: { method?: string }[] = [];
    stubApi({ rooms: [room()], onMutate: (_url, init) => mutations.push({ method: init?.method }) });
    renderPage(managerSession());
    await screen.findByText('101');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mutations).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete room' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('DELETE');
  });
});
