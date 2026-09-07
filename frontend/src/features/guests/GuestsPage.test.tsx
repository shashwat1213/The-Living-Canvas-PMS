import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import type { PageMeta } from '../../lib/pagination';
import { GuestsPage } from './GuestsPage';
import type { Guest } from './types';

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

const manageSession = () => session(['guests:read', 'guests:manage']);
const readOnlySession = () => session(['guests:read']);
const noAccessSession = () => session(['properties:read']);

function guest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: 'guest-1',
    organizationId: 'org-1',
    firstName: 'Asha',
    lastName: 'Menon',
    email: 'asha@example.com',
    phone: '+91 98765 43210',
    notes: null,
    reservationCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function listPage(rows: Guest[], overrides: Partial<PageMeta> = {}) {
  return {
    guests: rows,
    page: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1, ...overrides },
  };
}

function stubApi(options: {
  guests?: Guest[];
  mutationError?: { status: number; message: string };
  onMutate?: (url: string, init?: RequestInit) => void;
} = {}) {
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
      // DELETE returns 204 with no body.
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) } as Response);
    }
    return Promise.resolve(jsonResponse(listPage(options.guests ?? [])));
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
        <GuestsPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GuestsPage', () => {
  it('lists guests with their contact details and booking count', async () => {
    stubApi({ guests: [guest(), guest({ id: 'guest-2', firstName: 'Ravi', lastName: 'Iyer', email: 'ravi@example.com', reservationCount: 3 })] });
    renderPage(manageSession());

    expect(await screen.findByText('Asha Menon')).toBeInTheDocument();
    expect(screen.getByText('asha@example.com')).toBeInTheDocument();
    expect(screen.getByText('Ravi Iyer')).toBeInTheDocument();
    expect(screen.getByText('3 bookings')).toBeInTheDocument();
  });

  it('shows a manager the add button and an empty state prompt', async () => {
    stubApi({ guests: [] });
    renderPage(manageSession());

    expect(await screen.findByText('No guests yet — add your first guest above.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add guest' })).toBeInTheDocument();
  });

  it('hides management controls from a read-only user', async () => {
    stubApi({ guests: [guest()] });
    renderPage(readOnlySession());

    expect(await screen.findByText('Asha Menon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add guest' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // Read-only users still get a view entry point into the profile.
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('explains its absence to a user without guest access', async () => {
    stubApi({ guests: [guest()] });
    renderPage(noAccessSession());

    expect(await screen.findByText(/don.t have access to guest profiles/i)).toBeInTheDocument();
  });

  it('disables delete for a guest with reservations', async () => {
    stubApi({ guests: [guest({ reservationCount: 2 })] });
    renderPage(manageSession());

    await screen.findByText('Asha Menon');
    const del = screen.getByRole('button', { name: 'Delete' });
    expect(del).toBeDisabled();
  });

  it('deletes a guest with no reservations through a confirmation', async () => {
    let deleteUrl: string | undefined;
    stubApi({
      guests: [guest()],
      onMutate: (url, init) => {
        if (init?.method === 'DELETE') deleteUrl = url;
      },
    });
    renderPage(manageSession());

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    // ConfirmDialog appears; its confirm button also reads "Delete".
    const confirmButtons = await screen.findAllByRole('button', { name: 'Delete' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(deleteUrl).toContain('/api/v1/guests/guest-1');
    });
  });
});
