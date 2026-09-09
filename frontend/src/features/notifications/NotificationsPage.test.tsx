import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import { NotificationsPage } from './NotificationsPage';
import type { Notification } from './types';

function makeToken(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function session(permissions: string[]) {
  return readSessionClaims(
    makeToken({ sub: 'u1', organizationId: 'org-1', permissions, roleNames: ['OWNER'], grantedPropertyIds: [] }),
  );
}

function notif(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    channel: 'EMAIL',
    status: 'SENT',
    type: 'reservation.confirmation',
    recipient: 'ravi@example.com',
    subject: 'Booking confirmed — Seaside Villa (LC-ABC123)',
    body: 'Hi Ravi Kumar,\n\nYour booking is confirmed.',
    entityType: 'reservation',
    entityId: 'res-1',
    attempts: 1,
    lastError: null,
    sentAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

/** Stubs the notifications list endpoint. Records every requested URL and
 * asserts the feature only ever issues GETs (it is read-only). */
function stubApi(rows: Notification[], onList?: (url: string) => void) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    onList?.(String(url));
    expect(init?.method ?? 'GET').toBe('GET');
    return Promise.resolve(
      jsonResponse({
        notifications: rows,
        page: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(permissions: string[] = ['notifications:read']) {
  const value: AuthContextValue = {
    status: 'authenticated',
    session: session(permissions),
    login: vi.fn(),
    logout: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={value}>
      <NotificationsPage />
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('NotificationsPage', () => {
  it('lists notifications with their delivery status', async () => {
    stubApi([notif(), notif({ id: 'n2', status: 'FAILED', recipient: 'meera@example.com' })]);
    renderPage();

    expect(await screen.findByText('ravi@example.com')).toBeInTheDocument();
    expect(screen.getByText('meera@example.com')).toBeInTheDocument();
    // Status shows as a badge in the table (the word also appears as a
    // filter <option>, so assert at least one occurrence).
    expect(screen.getAllByText('Sent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a no-access state without calling the API when the permission is missing', async () => {
    const fetchMock = stubApi([]);
    renderPage(['properties:read']);

    expect(await screen.findByText(/don't have access to the notification log/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the status filter to the server as a query parameter', async () => {
    const urls: string[] = [];
    stubApi([notif()], (url) => urls.push(url));
    renderPage();

    await screen.findByText('ravi@example.com');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'FAILED' } });

    await waitFor(() => {
      expect(urls.some((u) => u.includes('status=FAILED'))).toBe(true);
    });
  });

  it('debounces search into a single query parameter', async () => {
    const urls: string[] = [];
    stubApi([notif()], (url) => urls.push(url));
    renderPage();

    await screen.findByText('ravi@example.com');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'ravi' } });

    await waitFor(() => {
      expect(urls.some((u) => u.includes('search=ravi'))).toBe(true);
    });
  });

  it('opens a read-only detail dialog showing the full message body', async () => {
    stubApi([notif()]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Your booking is confirmed/)).toBeInTheDocument();
    // No edit/save affordance — it's a record, not a draft.
    expect(within(dialog).queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });
});
