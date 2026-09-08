import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import { PosPage } from './PosPage';

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
      roleNames: ['MANAGER'],
      grantedPropertyIds: [PROPERTY_ID],
    }),
  );
}

const fullSession = () => session(['properties:read', 'pos:read', 'pos:operate', 'pos:manage']);
const readOnlySession = () => session(['properties:read', 'pos:read']);
const noAccessSession = () => session(['properties:read']);

const OUTLET = { id: 'o1', name: 'Rooftop Bar', type: 'BAR', isActive: true, createdAt: '', updatedAt: '' };
const PRODUCT = {
  id: 'p1',
  outletId: 'o1',
  name: 'Negroni',
  sku: 'NG1',
  category: null,
  priceMinor: 65000,
  trackStock: false,
  stockQty: 0,
  isActive: true,
  createdAt: '',
  updatedAt: '',
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function stubApi(options: { onOrder?: (body: unknown) => void } = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('/pos/outlets') && url.includes('/products')) {
      return Promise.resolve(jsonResponse({ products: [PRODUCT], page: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } }));
    }
    if (url.includes('/pos/outlets')) {
      return Promise.resolve(jsonResponse({ outlets: [OUTLET], page: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } }));
    }
    if (url.includes('/pos/orders') && init?.method === 'POST') {
      options.onOrder?.(JSON.parse(String(init.body)));
      return Promise.resolve(
        jsonResponse(
          {
            order: {
              id: 'ord-1',
              reference: 'POS-ABC123',
              status: 'PAID',
              settlement: 'DIRECT',
              outlet: { id: 'o1', name: 'Rooftop Bar', type: 'BAR' },
              reservation: null,
              paymentMethod: 'CASH',
              totalMinor: 65000,
              folioChargeId: null,
              notes: null,
              settledAt: '',
              createdAt: '',
              items: [],
            },
          },
          true,
          201,
        ),
      );
    }
    if (url.includes('/pos/orders')) {
      return Promise.resolve(jsonResponse({ orders: [], page: { page: 1, pageSize: 15, totalItems: 0, totalPages: 0 } }));
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
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/pos`]}>
        <Routes>
          <Route path="/app/properties/:propertyId/pos" element={<PosPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PosPage', () => {
  it('shows the outlet tab and its catalogue', async () => {
    stubApi();
    renderPage(fullSession());

    expect(await screen.findByRole('heading', { name: 'Point of sale — Seaside Villa' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Rooftop Bar/ })).toBeInTheDocument();
    expect(await screen.findByText('Negroni')).toBeInTheDocument();
  });

  it('adds a product to the cart and places a direct-paid order', async () => {
    const bodies: unknown[] = [];
    stubApi({ onOrder: (b) => bodies.push(b) });
    renderPage(fullSession());

    // Tap the product to add it to the cart.
    fireEvent.click(await screen.findByRole('button', { name: /Negroni/ }));

    // Cart shows a total and a place-order button.
    const placeBtn = await screen.findByRole('button', { name: /Place order/ });
    expect(placeBtn).toBeEnabled();

    fireEvent.click(placeBtn);

    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]).toMatchObject({
      outletId: 'o1',
      items: [{ productId: 'p1', quantity: 1 }],
      settlement: 'DIRECT',
      paymentMethod: 'CASH',
    });
    // Success flash naming the reference.
    expect(await screen.findByText(/POS-ABC123/)).toBeInTheDocument();
  });

  it('requires a reservation id before a room-charge order can be placed', async () => {
    stubApi();
    renderPage(fullSession());

    fireEvent.click(await screen.findByRole('button', { name: /Negroni/ }));
    // Switch to charge-to-room.
    fireEvent.click(screen.getByLabelText('Charge to room'));

    // Without a reservation id the place button is disabled.
    const placeBtn = screen.getByRole('button', { name: /Place order/ });
    expect(placeBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reservation ID'), { target: { value: 'resv-1' } });
    expect(placeBtn).toBeEnabled();
  });

  it('read-only access cannot add products to an order', async () => {
    stubApi();
    renderPage(readOnlySession());

    // The product button is disabled for a read-only user (cannot operate).
    const productBtn = await screen.findByRole('button', { name: /Negroni/ });
    expect(productBtn).toBeDisabled();
    // No manage controls either.
    expect(screen.queryByRole('button', { name: /New outlet/ })).not.toBeInTheDocument();
  });

  it('gates the whole screen behind pos:read', async () => {
    const fetchMock = stubApi();
    renderPage(noAccessSession());

    expect(await screen.findByText(/don't have access to point of sale/i)).toBeInTheDocument();
    const posCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/pos/'));
    expect(posCalls).toHaveLength(0);
  });
});
