import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import { MaintenancePage } from './MaintenancePage';
import type { WorkOrderListResult } from './api';

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

const manageSession = () => session(['maintenance:read', 'maintenance:manage']);
const readOnlySession = () => session(['maintenance:read']);
const noAccessSession = () => session(['properties:read']);

function workOrders(): WorkOrderListResult {
  return {
    workOrders: [
      {
        id: 'wo-1',
        propertyId: PROPERTY_ID,
        title: 'AC not cooling',
        description: 'Warm room',
        category: 'HVAC',
        priority: 'HIGH',
        status: 'OPEN',
        takesRoomOutOfService: true,
        resolvedAt: null,
        createdAt: '2026-10-03T08:00:00.000Z',
        updatedAt: '2026-10-03T08:00:00.000Z',
        room: { id: 'room-1', name: '101', floor: '1', status: 'MAINTENANCE' },
        assignedTo: null,
      },
    ],
    page: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function stubApi(options: { onPatch?: (url: string, init: RequestInit) => void } = {}) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    if (url.includes('/maintenance/work-orders') && (init.method === undefined || init.method === 'GET')) {
      return Promise.resolve(jsonResponse(workOrders()));
    }
    if (url.match(/\/work-orders\/[^/]+$/) && init.method === 'PATCH') {
      options.onPatch?.(url, init);
      return Promise.resolve(jsonResponse({ workOrder: { ...workOrders().workOrders[0], status: 'IN_PROGRESS' } }));
    }
    // getProperty
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
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/maintenance`]}>
        <Routes>
          <Route path="/app/properties/:propertyId/maintenance" element={<MaintenancePage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MaintenancePage', () => {
  it('lists work orders with priority, status and the out-of-service flag', async () => {
    stubApi();
    renderPage(manageSession());

    expect(await screen.findByRole('heading', { name: 'Maintenance — Seaside Villa' })).toBeInTheDocument();
    expect(screen.getByText('AC not cooling')).toBeInTheDocument();
    // "High"/"Open" also appear as filter <option>s, so assert within the row.
    const row = screen.getByRole('row', { name: /AC not cooling/ });
    expect(row).toHaveTextContent('High');
    expect(row).toHaveTextContent('Open');
    expect(screen.getByText('Room out of service')).toBeInTheDocument();
    // Room + category metadata line.
    expect(screen.getByText(/HVAC · Room 101/)).toBeInTheDocument();
  });

  it('starts an order with a PATCH from the Start action', async () => {
    let patched: { url: string; body: unknown } | null = null;
    stubApi({ onPatch: (url, init) => (patched = { url, body: JSON.parse(String(init.body)) }) });
    renderPage(manageSession());

    const start = await screen.findByRole('button', { name: 'Start' });
    fireEvent.click(start);

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched!.url).toContain('/work-orders/wo-1');
    expect(patched!.body).toEqual({ status: 'IN_PROGRESS' });
  });

  it('hides action buttons from a read-only user', async () => {
    stubApi();
    renderPage(readOnlySession());

    await screen.findByRole('heading', { name: 'Maintenance — Seaside Villa' });
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New work order' })).not.toBeInTheDocument();
  });

  it('explains its absence to a user without maintenance:read', async () => {
    stubApi();
    renderPage(noAccessSession());

    expect(await screen.findByText(/don.t have access to maintenance/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
