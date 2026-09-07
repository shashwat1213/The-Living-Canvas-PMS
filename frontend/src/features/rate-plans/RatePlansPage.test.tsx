import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import type { PageMeta } from '../../lib/pagination';
import { RatePlansPage } from './RatePlansPage';
import type { RatePlan } from './types';

const PROPERTY_ID = 'prop-1';
const ROOM_TYPE_ID = 'rt-1';

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

const managerSession = () => session(['properties:read', 'room-types:read', 'rate-plans:read', 'rate-plans:manage']);
const readOnlySession = () => session(['properties:read', 'room-types:read', 'rate-plans:read']);

function ratePlan(overrides: Partial<RatePlan> = {}): RatePlan {
  return {
    id: 'rp-1',
    roomTypeId: ROOM_TYPE_ID,
    name: 'Best Available Rate',
    code: 'BAR',
    description: 'Flexible',
    isRefundable: true,
    isActive: true,
    pricedDates: 5,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function listPage(rows: RatePlan[], overrides: Partial<PageMeta> = {}) {
  return {
    ratePlans: rows,
    page: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1, ...overrides },
  };
}

/**
 * The page issues independent GETs: the rate-plan list, the property heading,
 * and the room-type heading. The stub routes on the URL rather than call
 * order, and captures every mutating request so tests assert the *request*
 * the page builds rather than a filtered DOM.
 */
function stubApi(options: {
  ratePlans?: RatePlan[];
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
      return Promise.resolve(jsonResponse({ ratePlan: ratePlan() }));
    }
    if (url.includes('/rate-plans/') && url.includes('/rates')) {
      return Promise.resolve(jsonResponse({ ratePlanId: 'rp-1', from: '', to: '', rates: [] }));
    }
    if (url.includes('/rate-plans')) {
      return Promise.resolve(jsonResponse(listPage(options.ratePlans ?? [])));
    }
    if (url.includes('/room-types/')) {
      return Promise.resolve(jsonResponse({ roomType: { id: ROOM_TYPE_ID, name: 'Deluxe King' } }));
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
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/room-types/${ROOM_TYPE_ID}/rate-plans`]}>
        <Routes>
          <Route
            path="/app/properties/:propertyId/room-types/:roomTypeId/rate-plans"
            element={<RatePlansPage />}
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RatePlansPage', () => {
  it('names the room type in the heading and lists plans with their policy', async () => {
    stubApi({ ratePlans: [ratePlan(), ratePlan({ id: 'rp-2', name: 'Non-Refundable', code: 'NR', isRefundable: false })] });
    renderPage(managerSession());

    expect(await screen.findByRole('heading', { name: 'Rate plans — Deluxe King' })).toBeInTheDocument();
    expect(screen.getByText('Best Available Rate')).toBeInTheDocument();
    expect(screen.getByText('Non-Refundable')).toBeInTheDocument();
    expect(screen.getByText('Non-refundable')).toBeInTheDocument();
  });

  it('shows a manager the add button and an empty state that points at the rates calendar', async () => {
    stubApi({ ratePlans: [] });
    renderPage(managerSession());

    expect(
      await screen.findByText('No rate plans yet — add one, then set its nightly prices from the rates calendar.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add rate plan' })).toBeInTheDocument();
  });

  it('hides management controls from a read-only user', async () => {
    stubApi({ ratePlans: [ratePlan()] });
    renderPage(readOnlySession());

    expect(await screen.findByText('Best Available Rate')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rate plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    // Read-only users still get a view-only rates entry point.
    expect(screen.getByRole('button', { name: 'View rates' })).toBeInTheDocument();
  });

  it('opens the rate calendar for a plan and requests that plan\u2019s rates', async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      seenUrls.push(url);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/rates')) {
        return Promise.resolve(jsonResponse({ ratePlanId: 'rp-1', from: '', to: '', rates: [] }));
      }
      if (method === 'GET' && url.includes('/rate-plans')) {
        return Promise.resolve(jsonResponse(listPage([ratePlan()])));
      }
      if (url.includes('/room-types/')) {
        return Promise.resolve(jsonResponse({ roomType: { id: ROOM_TYPE_ID, name: 'Deluxe King' } }));
      }
      return Promise.resolve(jsonResponse({ property: { id: PROPERTY_ID, name: 'Seaside Villa' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage(managerSession());
    fireEvent.click(await screen.findByRole('button', { name: 'Rates' }));

    await waitFor(() => {
      expect(seenUrls.some((u) => u.includes(`/rate-plans/rp-1/rates?`))).toBe(true);
    });
    expect(await screen.findByRole('heading', { name: 'Rates — Best Available Rate' })).toBeInTheDocument();
  });
});
