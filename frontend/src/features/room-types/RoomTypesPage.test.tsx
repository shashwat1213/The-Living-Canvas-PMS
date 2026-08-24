import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import type { PageMeta } from '../../lib/pagination';
import { RoomTypesPage } from './RoomTypesPage';
import type { RoomType } from './types';

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

const managerSession = () => session(['properties:read', 'room-types:read', 'room-types:manage']);
const readOnlySession = () => session(['properties:read', 'room-types:read']);

function roomType(overrides: Partial<RoomType> = {}): RoomType {
  return {
    id: 'rt-1',
    propertyId: PROPERTY_ID,
    name: 'Deluxe King',
    code: 'DLXK',
    description: 'Corner room, king bed.',
    isActive: true,
    roomCount: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function listPage(rows: RoomType[], overrides: Partial<PageMeta> = {}) {
  return {
    roomTypes: rows,
    page: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1, ...overrides },
  };
}

/**
 * The page issues two independent GETs — the catalogue and the property
 * heading — so the stub routes on the URL rather than call order.
 */
function stubApi(options: {
  roomTypes?: RoomType[];
  pageOverrides?: Partial<PageMeta>;
  listError?: { status: number; message: string };
  mutationError?: { status: number; message: string };
  propertyFails?: boolean;
  onMutate?: (url: string, init?: RequestInit) => void;
  onList?: (url: string) => void;
}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      options.onMutate?.(url, init);
      if (options.mutationError) {
        return Promise.resolve(
          jsonResponse(
            { error: { code: 'conflict', message: options.mutationError.message } },
            false,
            options.mutationError.status,
          ),
        );
      }
      return Promise.resolve(jsonResponse({ roomType: roomType() }));
    }
    if (url.includes('/room-types')) {
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
      return Promise.resolve(jsonResponse(listPage(options.roomTypes ?? [], options.pageOverrides)));
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
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/room-types`]}>
        <Routes>
          <Route path="/app/properties/:propertyId/room-types" element={<RoomTypesPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const lastUrl = (urls: string[]) => urls[urls.length - 1] ?? '';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RoomTypesPage — loading, empty and error states', () => {
  it('shows an empty state that says what happens until a type exists', async () => {
    stubApi({ roomTypes: [] });
    renderPage(managerSession());

    expect(
      await screen.findByText('No room types yet — add your first one above. Until then, rooms keep a free-text type.'),
    ).toBeInTheDocument();
  });

  it('names the property in the heading and links back to Properties and Rooms', async () => {
    stubApi({ roomTypes: [roomType()] });
    renderPage(managerSession());

    expect(await screen.findByRole('heading', { name: 'Room types — Seaside Villa' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Properties' })).toHaveAttribute('href', '/app/properties');
    expect(screen.getByRole('link', { name: 'Rooms' })).toHaveAttribute(
      'href',
      `/app/properties/${PROPERTY_ID}/rooms`,
    );
  });

  it('still renders the table when the property heading fails to load', async () => {
    stubApi({ roomTypes: [roomType()], propertyFails: true });
    renderPage(managerSession());

    expect(await screen.findByText('Deluxe King')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Room types' })).toBeInTheDocument();
  });

  it('surfaces the API message when the list fails', async () => {
    stubApi({ listError: { status: 404, message: 'Property not found.' } });
    renderPage(managerSession());

    expect(await screen.findByRole('alert')).toHaveTextContent('Property not found.');
  });

  it('renders the code and room count alongside the name', async () => {
    stubApi({ roomTypes: [roomType({ roomCount: 12 })] });
    renderPage(managerSession());

    await screen.findByText('Deluxe King');
    const table = screen.getByRole('table');
    expect(within(table).getByText('DLXK')).toBeInTheDocument();
    expect(within(table).getByText('12')).toBeInTheDocument();
  });

  it('shows a retired type as Retired, not Inactive', async () => {
    stubApi({ roomTypes: [roomType({ isActive: false })] });
    renderPage(managerSession());

    await screen.findByText('Deluxe King');
    expect(within(screen.getByRole('table')).getByText('Retired')).toBeInTheDocument();
  });
});

describe('RoomTypesPage — filters', () => {
  it('sends search and status to the server, not a client-side filter', async () => {
    const urls: string[] = [];
    stubApi({ roomTypes: [roomType()], onList: (url) => urls.push(url) });
    renderPage(managerSession());
    await screen.findByText('Deluxe King');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'deluxe' } });
    await waitFor(() => expect(lastUrl(urls)).toContain('search=deluxe'));

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'INACTIVE' } });
    await waitFor(() => expect(lastUrl(urls)).toContain('status=INACTIVE'));
  });

  it('offers a way out of a filtered empty state', async () => {
    stubApi({ roomTypes: [] });
    renderPage(managerSession());
    await screen.findByText(/No room types yet/);

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ACTIVE' } });

    expect(await screen.findByText('No room types match those filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText(/No room types yet/)).toBeInTheDocument();
  });
});

describe('RoomTypesPage — permission gating (presentation only)', () => {
  it('hides every mutating control from a caller with read but not manage', async () => {
    stubApi({ roomTypes: [roomType()] });
    renderPage(readOnlySession());

    await screen.findByText('Deluxe King');
    expect(screen.queryByRole('button', { name: 'Add room type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retire' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // The catalogue itself is still readable.
    expect(within(screen.getByRole('table')).getByText('Active')).toBeInTheDocument();
  });
});

describe('RoomTypesPage — create and edit', () => {
  it('creates a room type, omitting blank optional fields', async () => {
    const mutations: { url: string; method?: string; body: Record<string, unknown> }[] = [];
    stubApi({
      roomTypes: [],
      onMutate: (url, init) =>
        mutations.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> }),
    });
    renderPage(managerSession());
    await screen.findByText(/No room types yet/);

    fireEvent.click(screen.getByRole('button', { name: 'Add room type' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Garden Suite' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add room type' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('POST');
    expect(mutations[0]?.url).toContain(`/api/v1/properties/${PROPERTY_ID}/room-types`);
    expect(mutations[0]?.body).toEqual({ name: 'Garden Suite' });
  });

  it('rejects a malformed code before sending anything', async () => {
    const mutations: unknown[] = [];
    stubApi({ roomTypes: [], onMutate: () => mutations.push(true) });
    renderPage(managerSession());
    await screen.findByText(/No room types yet/);

    fireEvent.click(screen.getByRole('button', { name: 'Add room type' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Garden Suite' } });
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: 'GS 1!' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add room type' }));

    expect(await within(dialog).findByText('Use letters, numbers or hyphens only.')).toBeInTheDocument();
    expect(mutations).toHaveLength(0);
  });

  it('requires a name', async () => {
    const mutations: unknown[] = [];
    stubApi({ roomTypes: [], onMutate: () => mutations.push(true) });
    renderPage(managerSession());
    await screen.findByText(/No room types yet/);

    fireEvent.click(screen.getByRole('button', { name: 'Add room type' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add room type' }));

    expect(await within(dialog).findByText('Name is required.')).toBeInTheDocument();
    expect(mutations).toHaveLength(0);
  });

  it('sends only the fields that changed on edit', async () => {
    const mutations: { method?: string; body: Record<string, unknown> }[] = [];
    stubApi({
      roomTypes: [roomType()],
      onMutate: (_url, init) =>
        mutations.push({ method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> }),
    });
    renderPage(managerSession());
    await screen.findByText('Deluxe King');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Deluxe Twin' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('PATCH');
    expect(mutations[0]?.body).toEqual({ name: 'Deluxe Twin' });
  });

  it('treats a recased code as no change, since the server stores it upper-case', async () => {
    stubApi({ roomTypes: [roomType()] });
    renderPage(managerSession());
    await screen.findByText('Deluxe King');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: 'dlxk' } });

    // Nothing to save, so the control that would send it is not offered.
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('says a code cannot be cleared rather than sending a payload the API rejects', async () => {
    const mutations: unknown[] = [];
    stubApi({ roomTypes: [roomType()], onMutate: () => mutations.push(true) });
    renderPage(managerSession());
    await screen.findByText('Deluxe King');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await within(dialog).findByText(/A code cannot be removed once set/)).toBeInTheDocument();
    expect(mutations).toHaveLength(0);
  });

  it('surfaces a duplicate-name conflict from the API', async () => {
    stubApi({
      roomTypes: [roomType()],
      mutationError: { status: 409, message: 'A room type with that name already exists at this property.' },
    });
    renderPage(managerSession());
    await screen.findByText('Deluxe King');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Garden Suite' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A room type with that name already exists at this property.',
    );
  });
});

describe('RoomTypesPage — retire, restore and delete', () => {
  it('warns that rooms keep a retired type, then PATCHes isActive', async () => {
    const mutations: { method?: string; body: Record<string, unknown> }[] = [];
    stubApi({
      roomTypes: [roomType({ roomCount: 4 })],
      onMutate: (_url, init) =>
        mutations.push({ method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> }),
    });
    renderPage(managerSession());
    await screen.findByText('Deluxe King');

    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('The 4 rooms already using it keep it');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retire room type' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('PATCH');
    expect(mutations[0]?.body).toEqual({ isActive: false });
  });

  it('sends nothing when a retire is cancelled', async () => {
    const mutations: unknown[] = [];
    stubApi({ roomTypes: [roomType({ roomCount: 1 })], onMutate: () => mutations.push(true) });
    renderPage(managerSession());
    await screen.findByText('Deluxe King');

    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mutations).toHaveLength(0);
  });

  it('restores a retired type without a confirmation step', async () => {
    const mutations: { method?: string; body: Record<string, unknown> }[] = [];
    stubApi({
      roomTypes: [roomType({ isActive: false })],
      onMutate: (_url, init) =>
        mutations.push({ method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> }),
    });
    renderPage(managerSession());
    await screen.findByText('Deluxe King');

    expect(screen.queryByRole('button', { name: 'Retire' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.body).toEqual({ isActive: true });
  });

  it('offers Delete only for a type no room uses', async () => {
    stubApi({ roomTypes: [roomType({ roomCount: 3 })] });
    renderPage(managerSession());
    await screen.findByText('Deluxe King');

    // A hard delete would SET NULL across three rooms; the API refuses it,
    // so the button that could only 409 is not offered.
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retire' })).toBeInTheDocument();
  });

  it('confirms, then deletes an unused type', async () => {
    const mutations: { method?: string }[] = [];
    stubApi({ roomTypes: [roomType()], onMutate: (_url, init) => mutations.push({ method: init?.method }) });
    renderPage(managerSession());
    await screen.findByText('Deluxe King');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete room type' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('DELETE');
  });

  it('shows the API conflict verbatim when a delete races an assignment', async () => {
    stubApi({
      roomTypes: [roomType()],
      mutationError: {
        status: 409,
        message: 'This room type is still assigned to 2 rooms. Reassign those rooms first, or set it inactive to retire it instead.',
      },
    });
    renderPage(managerSession());
    await screen.findByText('Deluxe King');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete room type' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This room type is still assigned to 2 rooms.');
  });
});
