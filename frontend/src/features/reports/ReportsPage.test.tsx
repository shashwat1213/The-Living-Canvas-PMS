import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import { ReportsPage } from './ReportsPage';
import type { RevenueReport } from './types';

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

const readSession = () => session(['properties:read', 'reports:read']);
const noAccessSession = () => session(['properties:read']);

function report(overrides: Partial<RevenueReport> = {}): RevenueReport {
  return {
    from: '2026-10-01',
    to: '2026-10-03',
    nights: 2,
    sellableRooms: 4,
    summary: {
      roomRevenueMinor: 900000,
      roomsSold: 2,
      roomNightsAvailable: 8,
      occupancyPct: 25,
      adrMinor: 450000,
      revparMinor: 112500,
      paymentsCollectedMinor: 800000,
    },
    days: [
      {
        date: '2026-10-01',
        roomRevenueMinor: 450000,
        roomsSold: 1,
        roomsAvailable: 4,
        occupancyPct: 25,
        adrMinor: 450000,
        revparMinor: 112500,
      },
      {
        date: '2026-10-02',
        roomRevenueMinor: 450000,
        roomsSold: 1,
        roomsAvailable: 4,
        occupancyPct: 25,
        adrMinor: 450000,
        revparMinor: 112500,
      },
    ],
    paymentsByMethod: [
      { method: 'CARD', amountMinor: 500000, count: 1 },
      { method: 'CASH', amountMinor: 300000, count: 2 },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function stubApi(options: { response?: RevenueReport; onReport?: (url: string) => void } = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/reports/revenue')) {
      options.onReport?.(url);
      return Promise.resolve(jsonResponse(options.response ?? report()));
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
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/reports`]}>
        <Routes>
          <Route path="/app/properties/:propertyId/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReportsPage', () => {
  it('renders the metric strip with revenue, occupancy, ADR and RevPAR', async () => {
    stubApi();
    renderPage(readSession());

    expect(await screen.findByRole('heading', { name: 'Revenue & occupancy — Seaside Villa' })).toBeInTheDocument();

    // Occupancy percentage with its room-nights hint, scoped to the metric strip
    // (the same 25% also appears per-night in the table below).
    const strip = document.querySelector('.reports-metrics') as HTMLElement;
    expect(within(strip).getByText('25%')).toBeInTheDocument();
    expect(within(strip).getByText('2 of 8 room-nights')).toBeInTheDocument();
    // Room revenue formatted from paise (₹9,000 compact).
    expect(screen.getAllByText(/₹9,000/).length).toBeGreaterThan(0);
  });

  it('renders a per-night row and the totals footer', async () => {
    stubApi();
    renderPage(readSession());

    const row = await screen.findByRole('row', { name: /1 Oct/ });
    // Sold count over available.
    expect(within(row).getByText('1/4')).toBeInTheDocument();

    const totals = screen.getByRole('row', { name: /Total/ });
    // 2 of 8 room-nights sold across the window.
    expect(within(totals).getByText('2/8')).toBeInTheDocument();
  });

  it('lists payments collected by method, highest first', async () => {
    stubApi();
    renderPage(readSession());

    const aside = (await screen.findByRole('heading', { name: 'Payments collected' })).closest(
      '.reports-payments',
    ) as HTMLElement;
    expect(within(aside).getByText('Card')).toBeInTheDocument();
    expect(within(aside).getByText('Cash')).toBeInTheDocument();
    expect(within(aside).getByText('2 payments')).toBeInTheDocument();
  });

  it('requests an earlier window when Earlier is clicked', async () => {
    const urls: string[] = [];
    stubApi({ onReport: (url) => urls.push(url) });
    renderPage(readSession());

    await screen.findByRole('heading', { name: 'Revenue & occupancy — Seaside Villa' });
    const first = urls.length;

    fireEvent.click(screen.getByRole('button', { name: /Earlier/ }));

    await waitFor(() => expect(urls.length).toBeGreaterThan(first));
    const last = urls[urls.length - 1];
    expect(last).toMatch(/[?&]from=\d{4}-\d{2}-\d{2}/);
    expect(last).toMatch(/[?&]to=\d{4}-\d{2}-\d{2}/);
  });

  it('gates the screen behind reports:read (presentation only)', async () => {
    const fetchMock = stubApi();
    renderPage(noAccessSession());

    expect(await screen.findByText(/don't have access to this property's reports/i)).toBeInTheDocument();
    const reportCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/reports/revenue'));
    expect(reportCalls).toHaveLength(0);
  });
});
