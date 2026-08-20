import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import type { PageMeta } from '../../lib/pagination';
import { AuditPage } from './AuditPage';
import type { AuditEntry } from './types';

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

const auditorSession = () => session(['audit:read']);
const noAccessSession = () => session(['properties:read']);

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'entry-1',
    action: 'property.created',
    entityType: 'property',
    entityId: 'prop-1',
    actorType: 'USER',
    actorUserId: 'user-9',
    actorEmail: 'olive@example.com',
    actor: { id: 'user-9', firstName: 'Olive', lastName: 'Owner', email: 'olive@example.com' },
    metadata: { name: 'Seaside Villa', slug: 'seaside-villa' },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function auditPage(rows: AuditEntry[], overrides: Partial<PageMeta> = {}) {
  return {
    auditLogs: rows,
    page: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1, ...overrides },
  };
}

function stubApi(options: {
  entries?: AuditEntry[];
  pageOverrides?: Partial<PageMeta>;
  listError?: { status: number; message: string };
  onList?: (url: string) => void;
}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    options.onList?.(url);
    // A read-only feature: anything other than GET would be a defect.
    expect(init?.method ?? 'GET').toBe('GET');
    if (options.listError) {
      return Promise.resolve(
        jsonResponse(
          { error: { code: 'forbidden', message: options.listError.message } },
          false,
          options.listError.status,
        ),
      );
    }
    return Promise.resolve(jsonResponse(auditPage(options.entries ?? [], options.pageOverrides)));
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
        <AuditPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const lastUrl = (urls: string[]) => urls[urls.length - 1] ?? '';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuditPage — loading, empty and error states', () => {
  it('shows an empty state when nothing has happened yet', async () => {
    stubApi({ entries: [] });
    renderPage(auditorSession());

    expect(await screen.findByText(/Nothing has happened yet/i)).toBeInTheDocument();
  });

  it('renders an entry with its action, summary and actor', async () => {
    stubApi({ entries: [entry()] });
    renderPage(auditorSession());

    expect(await screen.findByText('Created Seaside Villa (/seaside-villa)')).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Property added')).toBeInTheDocument();
    expect(table.getByText('Olive Owner')).toBeInTheDocument();
  });

  it('surfaces the API error message when loading fails', async () => {
    stubApi({ listError: { status: 500, message: 'Could not load the activity log.' } });
    renderPage(auditorSession());

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the activity log.');
  });
});

describe('AuditPage — permission gating (presentation only)', () => {
  it('explains the page instead of loading it without audit:read', async () => {
    const fetchMock = stubApi({ entries: [] });
    renderPage(noAccessSession());

    expect(await screen.findByText(/don't have access to the activity log/i)).toBeInTheDocument();
    // It doesn't fire a request it knows will be refused.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes no way to create, edit or delete an entry', async () => {
    stubApi({ entries: [entry()] });
    renderPage(auditorSession());

    await screen.findByText('Created Seaside Villa (/seaside-villa)');
    for (const label of [/add/i, /new/i, /edit/i, /delete/i, /remove/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });
});

describe('AuditPage — server-side filters', () => {
  it('sends the action filter as a query parameter', async () => {
    const urls: string[] = [];
    stubApi({ entries: [entry()], onList: (url) => urls.push(url) });
    renderPage(auditorSession());
    await screen.findByText('Created Seaside Villa (/seaside-villa)');

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'staff.role_changed' } });

    await waitFor(() => expect(decodeURIComponent(lastUrl(urls))).toContain('action=staff.role_changed'));
  });

  it('sends the record-type filter as a query parameter', async () => {
    const urls: string[] = [];
    stubApi({ entries: [entry()], onList: (url) => urls.push(url) });
    renderPage(auditorSession());
    await screen.findByText('Created Seaside Villa (/seaside-villa)');

    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'room' } });

    await waitFor(() => expect(lastUrl(urls)).toContain('entityType=room'));
  });

  it('omits filters that are not set', async () => {
    const urls: string[] = [];
    stubApi({ entries: [entry()], onList: (url) => urls.push(url) });
    renderPage(auditorSession());
    await screen.findByText('Created Seaside Villa (/seaside-villa)');

    expect(lastUrl(urls)).not.toContain('action=');
    expect(lastUrl(urls)).not.toContain('entityType=');
    expect(lastUrl(urls)).not.toContain('actorUserId=');
  });

  it('offers a way back when filters match nothing', async () => {
    stubApi({ entries: [] });
    renderPage(auditorSession());
    await screen.findByText(/Nothing has happened yet/i);

    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'room' } });

    expect(await screen.findByText('No activity matches those filters.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0] as HTMLElement);
    expect(await screen.findByText(/Nothing has happened yet/i)).toBeInTheDocument();
  });
});

describe('AuditPage — drilling into an entry', () => {
  it('opens a read-only detail dialog with the target and actor', async () => {
    stubApi({ entries: [entry()] });
    renderPage(auditorSession());
    await screen.findByText('Created Seaside Villa (/seaside-villa)');

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('prop-1')).toBeInTheDocument();
    expect(within(dialog).getByText('Olive Owner')).toBeInTheDocument();
    expect(within(dialog).getByText('USER')).toBeInTheDocument();
    // Read-only: the only footer control closes it.
    expect(within(dialog).queryByRole('button', { name: /save|edit|delete/i })).not.toBeInTheDocument();
  });

  it('renders a before/after table for an update diff', async () => {
    stubApi({
      entries: [
        entry({
          id: 'e2',
          action: 'property.updated',
          metadata: {
            name: 'Seaside Villa',
            changed: { name: { from: 'Old Name', to: 'Seaside Villa' }, isActive: { from: true, to: false } },
          },
        }),
      ],
    });
    renderPage(auditorSession());
    await screen.findByText(/changed name, is active/i);

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText('Old Name')).toBeInTheDocument();
    // Booleans read as Yes/No rather than true/false.
    expect(within(dialog).getByText('Yes')).toBeInTheDocument();
    expect(within(dialog).getByText('No')).toBeInTheDocument();
  });

  it('filters to one actor via the detail dialog, using the real query param', async () => {
    const urls: string[] = [];
    stubApi({ entries: [entry()], onList: (url) => urls.push(url) });
    renderPage(auditorSession());
    await screen.findByText('Created Seaside Villa (/seaside-villa)');

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /everything by this person/i }));

    await waitFor(() => expect(lastUrl(urls)).toContain('actorUserId=user-9'));
    // The active drill-down is shown as a removable chip.
    expect(await screen.findByRole('button', { name: /one person's actions/i })).toBeInTheDocument();
  });

  it("filters to one record's history, and the chip clears it", async () => {
    const urls: string[] = [];
    stubApi({ entries: [entry()], onList: (url) => urls.push(url) });
    renderPage(auditorSession());
    await screen.findByText('Created Seaside Villa (/seaside-villa)');

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /this record's history/i }));

    await waitFor(() => expect(lastUrl(urls)).toContain('entityId=prop-1'));

    fireEvent.click(await screen.findByRole('button', { name: /one record's history/i }));
    await waitFor(() => expect(lastUrl(urls)).not.toContain('entityId='));
  });
});

describe('AuditPage — pagination', () => {
  it('shows the server position and requests the next page', async () => {
    const urls: string[] = [];
    stubApi({
      entries: [entry(), entry({ id: 'e2' })],
      pageOverrides: { pageSize: 2, totalItems: 5, totalPages: 3 },
      onList: (url) => urls.push(url),
    });
    renderPage(auditorSession());

    expect(await screen.findByText('1–2 of 5 entries')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastUrl(urls)).toContain('page=2'));
  });

  it('uses the correct singular for a single entry', async () => {
    stubApi({ entries: [entry()] });
    renderPage(auditorSession());

    expect(await screen.findByText('1 entry')).toBeInTheDocument();
  });

  it('returns to page 1 when a filter changes', async () => {
    const urls: string[] = [];
    stubApi({
      entries: [entry()],
      pageOverrides: { pageSize: 1, totalItems: 3, totalPages: 3 },
      onList: (url) => urls.push(url),
    });
    renderPage(auditorSession());
    await screen.findByText('Page 1 of 3');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastUrl(urls)).toContain('page=2'));

    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'staff' } });

    await waitFor(() => {
      expect(lastUrl(urls)).toContain('entityType=staff');
      expect(lastUrl(urls)).toContain('page=1');
    });
  });
});

describe('AuditPage — resilience to unfamiliar data', () => {
  it('renders an action this build does not know about', async () => {
    // A newer backend must not blank the page someone opened *because*
    // something unexpected happened.
    stubApi({ entries: [entry({ id: 'e9', action: 'lease.signed', entityType: 'lease', metadata: { foo: 1 } })] });
    renderPage(auditorSession());

    const table = within(await screen.findByRole('table'));
    expect(table.getAllByText('lease.signed').length).toBeGreaterThan(0);
  });

  it('renders an entry whose metadata is null or malformed', async () => {
    stubApi({
      entries: [
        entry({ id: 'a', action: 'property.created', metadata: null }),
        entry({ id: 'b', action: 'staff.role_changed', metadata: 'not-an-object' }),
      ],
    });
    renderPage(auditorSession());

    expect(await screen.findByText('Created a property')).toBeInTheDocument();
    // Scoped to the table: "Role changed" is also an option in the action
    // filter. Within the row it appears twice — as the action badge, and as
    // the summary, which falls back to the action's own wording when the
    // metadata is unreadable rather than rendering an empty cell.
    const table = within(screen.getByRole('table'));
    expect(table.getAllByText('Role changed')).toHaveLength(2);
  });

  it('falls back to the recorded email when the account is gone', async () => {
    stubApi({ entries: [entry({ actor: null, actorEmail: 'departed@example.com' })] });
    renderPage(auditorSession());

    expect(await screen.findByText('departed@example.com')).toBeInTheDocument();
  });

  it('shows a placeholder when both the account and the recorded email are gone', async () => {
    stubApi({ entries: [entry({ actor: null, actorEmail: null })] });
    renderPage(auditorSession());

    expect(await screen.findByText('Deleted account')).toBeInTheDocument();
  });
});
