import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import { StaffPage } from './StaffPage';
import type { StaffMember, SystemRoleName } from './types';

/**
 * The staff UI's authorization gating is driven by the access token's
 * claims, so these tests build real (unsigned) tokens rather than mocking
 * the session module — that exercises the actual decode path in
 * `auth/session.ts` alongside the component.
 *
 * The gating under test is presentational only. Every case that asserts a
 * control is hidden is asserting a UX property; the backend suite
 * (`backend/test/staff.test.ts`) is what proves the same action is
 * actually refused.
 */
function makeToken(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const OWNER_ID = 'user-owner';

function session(permissions: string[], roleNames: SystemRoleName[], userId = OWNER_ID) {
  return readSessionClaims(
    makeToken({
      sub: userId,
      organizationId: 'org-1',
      permissions,
      roleNames,
      grantedPropertyIds: [],
    }),
  );
}

const ownerSession = () => session(['staff:read', 'staff:manage', 'properties:read'], ['OWNER']);
const managerSession = () => session(['staff:read', 'properties:read'], ['MANAGER'], 'user-manager');
const noAccessSession = () => session(['properties:read'], ['STAFF'], 'user-staff');

function member(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: 'user-1',
    email: 'sam@example.com',
    firstName: 'Sam',
    lastName: 'Staffer',
    role: 'STAFF',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    roleNames: ['STAFF'],
    propertyIds: [],
    ...overrides,
  };
}

const ownerRow = member({
  id: OWNER_ID,
  email: 'owner@example.com',
  firstName: 'Olive',
  lastName: 'Owner',
  role: 'OWNER',
  roleNames: ['OWNER'],
});

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

/** Routes stubbed `fetch` calls by URL and method, like the real API. */
function stubApi(options: {
  staff?: StaffMember[];
  staffError?: { status: number; message: string };
  properties?: { id: string; name: string }[];
  onMutate?: (url: string, init?: RequestInit) => void;
}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';

    if (method !== 'GET') {
      options.onMutate?.(url, init);
      return Promise.resolve(jsonResponse({ staff: member() }));
    }
    if (url.includes('/api/v1/properties')) {
      return Promise.resolve(jsonResponse({ properties: options.properties ?? [] }));
    }
    if (url.includes('/api/v1/staff')) {
      if (options.staffError) {
        return Promise.resolve(
          jsonResponse(
            { error: { code: 'forbidden', message: options.staffError.message } },
            false,
            options.staffError.status,
          ),
        );
      }
      return Promise.resolve(jsonResponse({ staff: options.staff ?? [] }));
    }
    return Promise.resolve(jsonResponse({}));
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
        <StaffPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StaffPage — loading, empty and error states', () => {
  it('shows an empty state when the organization has no other staff', async () => {
    stubApi({ staff: [] });
    renderPage(ownerSession());

    expect(await screen.findByText('No staff yet — add your first team member above.')).toBeInTheDocument();
  });

  it('renders staff members with their role and status', async () => {
    stubApi({ staff: [ownerRow, member({ isActive: false })] });
    renderPage(ownerSession());

    expect(await screen.findByText('Sam Staffer')).toBeInTheDocument();
    expect(screen.getByText('sam@example.com')).toBeInTheDocument();

    // Scoped to the table: "Owner" and "Deactivated" also appear as
    // options in the role/status filters above it.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Owner')).toBeInTheDocument();
    expect(table.getByText('Deactivated')).toBeInTheDocument();
  });

  it('surfaces the API error message when loading fails', async () => {
    stubApi({ staffError: { status: 500, message: 'Could not load your team.' } });
    renderPage(ownerSession());

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your team.');
  });

  it('marks the signed-in user as themselves', async () => {
    stubApi({ staff: [ownerRow] });
    renderPage(ownerSession());

    expect(await screen.findByText('(you)')).toBeInTheDocument();
  });
});

describe('StaffPage — search and filters', () => {
  const roster = [
    ownerRow,
    member({ id: 'u2', firstName: 'Mary', lastName: 'Manager', email: 'mary@example.com', role: 'MANAGER', roleNames: ['MANAGER'] }),
    member({ id: 'u3', firstName: 'Sam', lastName: 'Staffer', email: 'sam@example.com' }),
  ];

  it('filters by name or email as you type', async () => {
    stubApi({ staff: roster });
    renderPage(ownerSession());
    await screen.findByText('Mary Manager');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'mary' } });

    expect(screen.getByText('Mary Manager')).toBeInTheDocument();
    expect(screen.queryByText('Olive Owner')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 shown')).toBeInTheDocument();
  });

  it('filters by role', async () => {
    stubApi({ staff: roster });
    renderPage(ownerSession());
    await screen.findByText('Mary Manager');

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'MANAGER' } });

    expect(screen.getByText('Mary Manager')).toBeInTheDocument();
    expect(screen.queryByText('Sam Staffer')).not.toBeInTheDocument();
  });

  it('filters by status', async () => {
    stubApi({ staff: [ownerRow, member({ id: 'u4', firstName: 'Dee', lastName: 'Parted', isActive: false })] });
    renderPage(ownerSession());
    await screen.findByText('Dee Parted');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'INACTIVE' } });

    expect(screen.getByText('Dee Parted')).toBeInTheDocument();
    expect(screen.queryByText('Olive Owner')).not.toBeInTheDocument();
  });

  it('offers a way back when filters match nobody', async () => {
    stubApi({ staff: roster });
    renderPage(ownerSession());
    await screen.findByText('Mary Manager');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nobody-by-that-name' } });
    expect(screen.getByText('No one matches those filters.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Mary Manager')).toBeInTheDocument();
  });
});

describe('StaffPage — permission gating (presentation only)', () => {
  it('explains the page instead of loading it without staff:read', async () => {
    const fetchMock = stubApi({ staff: [] });
    renderPage(noAccessSession());

    expect(await screen.findByText(/don't have access to staff administration/i)).toBeInTheDocument();
    // It also doesn't fire a request it knows will be refused.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides create and status controls from a reader who cannot manage staff', async () => {
    stubApi({ staff: [ownerRow, member()] });
    renderPage(managerSession());

    await screen.findByText('Sam Staffer');
    expect(screen.queryByRole('button', { name: 'Add staff member' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    // Reading is still offered.
    expect(screen.getAllByRole('button', { name: 'View' }).length).toBeGreaterThan(0);
  });

  it('offers management controls to an owner, but never on their own row', async () => {
    stubApi({ staff: [ownerRow, member()] });
    renderPage(ownerSession());

    await screen.findByText('Sam Staffer');
    expect(screen.getByRole('button', { name: 'Add staff member' })).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    const ownRow = rows.find((row) => within(row).queryByText('(you)'));
    const otherRow = rows.find((row) => within(row).queryByText('Sam Staffer'));

    expect(within(ownRow as HTMLElement).getByText('Your account')).toBeInTheDocument();
    expect(within(ownRow as HTMLElement).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(within(otherRow as HTMLElement).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });

  it('shows a peer as restricted rather than manageable', async () => {
    const peerAdmin = member({ id: 'u9', firstName: 'Al', lastName: 'Admin', role: 'ADMIN', roleNames: ['ADMIN'] });
    stubApi({ staff: [peerAdmin] });
    // An ADMIN viewing another ADMIN: same rank, so not manageable.
    renderPage(session(['staff:read', 'staff:manage'], ['ADMIN'], 'user-admin'));

    await screen.findByText('Al Admin');
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });
});

describe('StaffPage — deactivation', () => {
  it('confirms before deactivating, then sends isActive:false', async () => {
    const mutations: { url: string; body: unknown }[] = [];
    stubApi({
      staff: [ownerRow, member()],
      onMutate: (url, init) => mutations.push({ url, body: JSON.parse(String(init?.body)) }),
    });
    renderPage(ownerSession());

    await screen.findByText('Sam Staffer');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/signed out of every device immediately/i)).toBeInTheDocument();
    expect(mutations).toHaveLength(0); // nothing sent until confirmed

    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.url).toContain('/api/v1/staff/user-1');
    expect(mutations[0]?.body).toEqual({ isActive: false });
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    const mutations: unknown[] = [];
    stubApi({ staff: [ownerRow, member()], onMutate: () => mutations.push(true) });
    renderPage(ownerSession());

    await screen.findByText('Sam Staffer');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mutations).toHaveLength(0);
  });

  it('offers reactivation for a deactivated member', async () => {
    const mutations: { body: unknown }[] = [];
    stubApi({
      staff: [ownerRow, member({ isActive: false })],
      onMutate: (_url, init) => mutations.push({ body: JSON.parse(String(init?.body)) }),
    });
    renderPage(ownerSession());

    await screen.findByText('Sam Staffer');
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.body).toEqual({ isActive: true });
  });
});

describe('StaffPage — creating a staff member', () => {
  it('validates required fields before sending anything', async () => {
    const mutations: unknown[] = [];
    stubApi({ staff: [ownerRow], onMutate: () => mutations.push(true) });
    renderPage(ownerSession());

    await screen.findByText('Olive Owner');
    fireEvent.click(screen.getByRole('button', { name: 'Add staff member' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add staff member' }));

    expect(await within(dialog).findByText('First name is required.')).toBeInTheDocument();
    expect(within(dialog).getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(mutations).toHaveLength(0);
  });

  it('posts the new member using the real API contract', async () => {
    const mutations: { url: string; method?: string; body: Record<string, unknown> }[] = [];
    stubApi({
      staff: [ownerRow],
      properties: [{ id: 'prop-1', name: 'Seaside Villa' }],
      onMutate: (url, init) =>
        mutations.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> }),
    });
    renderPage(ownerSession());

    await screen.findByText('Olive Owner');
    fireEvent.click(screen.getByRole('button', { name: 'Add staff member' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: 'Mary' } });
    fireEvent.change(within(dialog).getByLabelText('Last name'), { target: { value: 'Manager' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'mary@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Temporary password'), {
      target: { value: 'correct-horse-battery-staple' },
    });
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'MANAGER' } });
    fireEvent.click(within(dialog).getByLabelText('Seaside Villa'));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add staff member' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('POST');
    expect(mutations[0]?.url).toMatch(/\/api\/v1\/staff$/);
    expect(mutations[0]?.body).toEqual({
      email: 'mary@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Mary',
      lastName: 'Manager',
      role: 'MANAGER',
      propertyIds: ['prop-1'],
    });
  });

  it('only offers roles at or below the caller’s own level', async () => {
    stubApi({ staff: [] });
    // An ADMIN must not be able to pick OWNER, matching the server rule.
    renderPage(session(['staff:read', 'staff:manage'], ['ADMIN'], 'user-admin'));

    await screen.findByText('No staff yet — add your first team member above.');
    fireEvent.click(screen.getByRole('button', { name: 'Add staff member' }));

    const dialog = await screen.findByRole('dialog');
    const roleOptions = within(dialog)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);

    expect(roleOptions).toEqual(['ADMIN', 'MANAGER', 'STAFF']);
    expect(roleOptions).not.toContain('OWNER');
  });

  it('shows the server’s message when the API rejects the create', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') !== 'GET') {
          return Promise.resolve(
            jsonResponse({ error: { code: 'conflict', message: 'That email is already in use.' } }, false, 409),
          );
        }
        if (url.includes('/api/v1/properties')) return Promise.resolve(jsonResponse({ properties: [] }));
        return Promise.resolve(jsonResponse({ staff: [ownerRow] }));
      }),
    );
    renderPage(ownerSession());

    await screen.findByText('Olive Owner');
    fireEvent.click(screen.getByRole('button', { name: 'Add staff member' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: 'Mary' } });
    fireEvent.change(within(dialog).getByLabelText('Last name'), { target: { value: 'Manager' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'taken@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Temporary password'), { target: { value: 'long-enough-pass' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add staff member' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That email is already in use.');
  });
});

describe('StaffPage — editing a staff member', () => {
  it('sends only what actually changed', async () => {
    const mutations: { url: string; method?: string; body: unknown }[] = [];
    stubApi({
      staff: [ownerRow, member()],
      properties: [{ id: 'prop-1', name: 'Seaside Villa' }],
      onMutate: (url, init) => mutations.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) }),
    });
    renderPage(ownerSession());

    await screen.findByText('Sam Staffer');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');

    // Change the role only — the name and property access are untouched.
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'MANAGER' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('PATCH');
    expect(mutations[0]?.body).toEqual({ role: 'MANAGER' });
  });

  it('writes property access through the PUT endpoint', async () => {
    const mutations: { url: string; method?: string; body: unknown }[] = [];
    stubApi({
      staff: [ownerRow, member()],
      properties: [{ id: 'prop-1', name: 'Seaside Villa' }],
      onMutate: (url, init) => mutations.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) }),
    });
    renderPage(ownerSession());

    await screen.findByText('Sam Staffer');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByLabelText('Seaside Villa'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]?.method).toBe('PUT');
    expect(mutations[0]?.url).toContain('/api/v1/staff/user-1/property-access');
    expect(mutations[0]?.body).toEqual({ propertyIds: ['prop-1'] });
  });

  it('opens read-only for a member the caller may not manage', async () => {
    stubApi({ staff: [ownerRow] });
    renderPage(ownerSession());

    await screen.findByText('Olive Owner');
    // The owner's own row offers "View", not "Edit".
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot change your own role/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('First name')).toBeDisabled();
  });
});

describe('StaffPage — dialog accessibility', () => {
  it('closes on Escape and returns focus to the trigger', async () => {
    stubApi({ staff: [ownerRow] });
    renderPage(ownerSession());

    await screen.findByText('Olive Owner');
    const trigger = screen.getByRole('button', { name: 'Add staff member' });
    // A real browser focuses a button when it's clicked; `fireEvent.click`
    // doesn't, and the restore-focus-on-close behaviour is only meaningful
    // relative to whatever actually held focus when the dialog opened.
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });
});
