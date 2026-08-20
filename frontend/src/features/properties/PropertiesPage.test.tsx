import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import type { PageMeta } from '../../lib/pagination';
import { PropertiesPage } from './PropertiesPage';
import type { Property } from './types';

/**
 * Search and filtering happen on the server, so these assert the
 * *request* the page makes rather than a filtered DOM — a DOM assertion
 * would still pass if the page had quietly reverted to filtering a full
 * local list, which is the regression worth catching.
 */
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
      grantedPropertyIds: [],
    }),
  );
}

const ownerSession = () =>
  session(['properties:read', 'properties:create', 'properties:update', 'properties:delete']);
const readOnlySession = () => session(['properties:read']);

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: 'prop-1',
    name: 'Seaside Villa',
    slug: 'seaside-villa',
    timezone: 'UTC',
    addressLine1: null,
    addressLine2: null,
    city: 'Goa',
    region: null,
    postalCode: null,
    country: 'India',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function propertiesPage(rows: Property[], overrides: Partial<PageMeta> = {}) {
  return {
    properties: rows,
    page: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1, ...overrides },
  };
}

function stubApi(options: {
  properties?: Property[];
  pageOverrides?: Partial<PageMeta>;
  listError?: { status: number; message: string };
  onMutate?: (url: string, init?: RequestInit) => void;
  onList?: (url: string) => void;
}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      options.onMutate?.(url, init);
      return Promise.resolve(jsonResponse({ property: property() }));
    }
    options.onList?.(url);
    if (options.listError) {
      return Promise.resolve(
        jsonResponse({ error: { code: 'error', message: options.listError.message } }, false, options.listError.status),
      );
    }
    return Promise.resolve(jsonResponse(propertiesPage(options.properties ?? [], options.pageOverrides)));
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
      <MemoryRouter>
        <PropertiesPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const lastUrl = (urls: string[]) => urls[urls.length - 1] ?? '';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PropertiesPage — loading, empty and error states', () => {
  it('shows an empty state when there are no properties', async () => {
    stubApi({ properties: [] });
    renderPage(ownerSession());

    expect(await screen.findByText('No properties yet — add your first one above.')).toBeInTheDocument();
  });

  it('lists properties with location, timezone and status', async () => {
    stubApi({
      properties: [
        property(),
        property({ id: 'p2', name: 'Old Wing', slug: 'old-wing', city: 'Jaipur', country: null, isActive: false }),
      ],
    });
    renderPage(ownerSession());

    expect(await screen.findByText('Seaside Villa')).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByText('/seaside-villa')).toBeInTheDocument();
    expect(table.getByText('Goa, India')).toBeInTheDocument();
    expect(table.getByText('Inactive')).toBeInTheDocument();
  });

  it('links each property to its rooms', async () => {
    stubApi({ properties: [property()] });
    renderPage(ownerSession());

    expect(await screen.findByRole('link', { name: 'Rooms' })).toHaveAttribute(
      'href',
      '/app/properties/prop-1/rooms',
    );
  });

  it('surfaces the API error message when loading fails', async () => {
    stubApi({ listError: { status: 500, message: 'Could not load properties.' } });
    renderPage(ownerSession());

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load properties.');
  });
});

describe('PropertiesPage — server-side search and filters', () => {
  it('debounces the search box into a single request', async () => {
    const urls: string[] = [];
    stubApi({ properties: [property()], onList: (url) => urls.push(url) });
    renderPage(ownerSession());
    await screen.findByText('Seaside Villa');
    const before = urls.length;

    const box = screen.getByLabelText('Search');
    fireEvent.change(box, { target: { value: 's' } });
    fireEvent.change(box, { target: { value: 'sea' } });
    fireEvent.change(box, { target: { value: 'seaside' } });

    expect(urls.length).toBe(before);
    await waitFor(() => expect(lastUrl(urls)).toContain('search=seaside'));
    expect(urls.length).toBe(before + 1);
  });

  it('sends the status filter to the server', async () => {
    const urls: string[] = [];
    stubApi({ properties: [property()], onList: (url) => urls.push(url) });
    renderPage(ownerSession());
    await screen.findByText('Seaside Villa');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'INACTIVE' } });

    await waitFor(() => expect(lastUrl(urls)).toContain('status=INACTIVE'));
  });

  it('omits filters that are not set', async () => {
    const urls: string[] = [];
    stubApi({ properties: [property()], onList: (url) => urls.push(url) });
    renderPage(ownerSession());
    await screen.findByText('Seaside Villa');

    expect(lastUrl(urls)).not.toContain('search=');
    expect(lastUrl(urls)).not.toContain('status=');
  });

  it('offers a way back when filters match nothing', async () => {
    stubApi({ properties: [] });
    renderPage(ownerSession());
    await screen.findByText('No properties yet — add your first one above.');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nothing' } });

    expect(await screen.findByText('No properties match those filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('No properties yet — add your first one above.')).toBeInTheDocument();
  });
});

describe('PropertiesPage — pagination', () => {
  it('shows the server position and requests the next page', async () => {
    const urls: string[] = [];
    stubApi({
      properties: [property(), property({ id: 'p2', name: 'Second', slug: 'second' })],
      pageOverrides: { pageSize: 2, totalItems: 5, totalPages: 3 },
      onList: (url) => urls.push(url),
    });
    renderPage(ownerSession());

    expect(await screen.findByText('1–2 of 5 properties')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastUrl(urls)).toContain('page=2'));
  });

  it('returns to page 1 when a filter changes', async () => {
    const urls: string[] = [];
    stubApi({
      properties: [property()],
      pageOverrides: { pageSize: 1, totalItems: 3, totalPages: 3 },
      onList: (url) => urls.push(url),
    });
    renderPage(ownerSession());
    await screen.findByText('Page 1 of 3');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastUrl(urls)).toContain('page=2'));

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ACTIVE' } });

    await waitFor(() => {
      expect(lastUrl(urls)).toContain('status=ACTIVE');
      expect(lastUrl(urls)).toContain('page=1');
    });
  });

  it('hides the controls when everything fits on one page', async () => {
    stubApi({ properties: [property()] });
    renderPage(ownerSession());

    await screen.findByText('Seaside Villa');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.getByText('1 property')).toBeInTheDocument();
  });
});

describe('PropertiesPage — permission gating (presentation only)', () => {
  it('hides create, edit and delete from a read-only caller', async () => {
    stubApi({ properties: [property()] });
    renderPage(readOnlySession());

    await screen.findByText('Seaside Villa');
    expect(screen.queryByRole('button', { name: 'Add property' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // Reading rooms is still offered.
    expect(screen.getByRole('link', { name: 'Rooms' })).toBeInTheDocument();
  });

  it('offers them to a caller who holds the permissions', async () => {
    stubApi({ properties: [property()] });
    renderPage(ownerSession());

    await screen.findByText('Seaside Villa');
    expect(screen.getByRole('button', { name: 'Add property' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});

describe('PropertiesPage — create and edit', () => {
  it('validates before sending anything', async () => {
    const mutations: unknown[] = [];
    stubApi({ properties: [], onMutate: () => mutations.push(true) });
    renderPage(ownerSession());
    await screen.findByText('No properties yet — add your first one above.');

    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add property' }));

    expect(await within(dialog).findByText('Name is required.')).toBeInTheDocument();
    expect(mutations).toHaveLength(0);
  });

  it('derives a slug from the name, and posts the real contract', async () => {
    const mutations: { url: string; method?: string; body: Record<string, unknown> }[] = [];
    stubApi({
      properties: [],
      onMutate: (url, init) =>
        mutations.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> }),
    });
    renderPage(ownerSession());
    await screen.findByText('No properties yet — add your first one above.');

    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Hilltop Retreat' } });
    expect((within(dialog).getByLabelText('Slug') as HTMLInputElement).value).toBe('hilltop-retreat');

    fireEvent.change(within(dialog).getByLabelText('City'), { target: { value: 'Shimla' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add property' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('POST');
    expect(mutations[0]?.body).toMatchObject({ name: 'Hilltop Retreat', slug: 'hilltop-retreat', city: 'Shimla' });
    // Blank optional fields are omitted rather than sent as empty strings.
    expect(mutations[0]?.body).not.toHaveProperty('region');
  });

  it('rejects an invalid slug before the request', async () => {
    const mutations: unknown[] = [];
    stubApi({ properties: [], onMutate: () => mutations.push(true) });
    renderPage(ownerSession());
    await screen.findByText('No properties yet — add your first one above.');

    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Valid Name' } });
    fireEvent.change(within(dialog).getByLabelText('Slug'), { target: { value: 'Not A Slug!' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add property' }));

    expect(await within(dialog).findByText('Lowercase letters, numbers and hyphens only.')).toBeInTheDocument();
    expect(mutations).toHaveLength(0);
  });

  it('edits an existing property with PATCH', async () => {
    const mutations: { url: string; method?: string; body: Record<string, unknown> }[] = [];
    stubApi({
      properties: [property()],
      onMutate: (url, init) =>
        mutations.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> }),
    });
    renderPage(ownerSession());
    await screen.findByText('Seaside Villa');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Seaside Resort' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('PATCH');
    expect(mutations[0]?.url).toContain('/api/v1/properties/prop-1');
    expect(mutations[0]?.body).toMatchObject({ name: 'Seaside Resort' });
  });

  it('editing does not silently rewrite an existing slug from the name', async () => {
    const mutations: { body: Record<string, unknown> }[] = [];
    stubApi({
      properties: [property()],
      onMutate: (_url, init) => mutations.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> }),
    });
    renderPage(ownerSession());
    await screen.findByText('Seaside Villa');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Totally New Name' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.body.slug).toBe('seaside-villa');
  });

  it('shows the server’s message when the API rejects the create', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') !== 'GET') {
          return Promise.resolve(
            jsonResponse(
              { error: { code: 'conflict', message: 'A property with that slug already exists.' } },
              false,
              409,
            ),
          );
        }
        return Promise.resolve(jsonResponse(propertiesPage([])));
      }),
    );
    renderPage(ownerSession());
    await screen.findByText('No properties yet — add your first one above.');

    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Dupe' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add property' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A property with that slug already exists.');
  });
});

describe('PropertiesPage — delete', () => {
  it('confirms, naming the room cascade, before deleting', async () => {
    const mutations: { url: string; method?: string }[] = [];
    stubApi({
      properties: [property()],
      onMutate: (url, init) => mutations.push({ url, method: init?.method }),
    });
    renderPage(ownerSession());
    await screen.findByText('Seaside Villa');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/every room recorded against it/i)).toBeInTheDocument();
    expect(mutations).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete property' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('DELETE');
    expect(mutations[0]?.url).toContain('/api/v1/properties/prop-1');
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    const mutations: unknown[] = [];
    stubApi({ properties: [property()], onMutate: () => mutations.push(true) });
    renderPage(ownerSession());
    await screen.findByText('Seaside Villa');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mutations).toHaveLength(0);
  });
});
