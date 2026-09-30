import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AnalyticsSection } from './AnalyticsSection';
import type { MonthlyAnalytics } from './analytics-types';

const PROPERTY_ID = 'prop-1';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function analytics(): MonthlyAnalytics {
  const months = [
    { month: '2026-08-01', label: 'Aug 2026', roomRevenueMinor: 2000000, posRevenueMinor: 100000, grossRevenueMinor: 2100000, paymentsCollectedMinor: 1500000, refundsMinor: 0, netCollectedMinor: 1500000, roomsSold: 40, roomNightsAvailable: 800, occupancyPct: 5, adrMinor: 50000, revparMinor: 2500 },
    { month: '2026-09-01', label: 'Sep 2026', roomRevenueMinor: 2740000, posRevenueMinor: 120000, grossRevenueMinor: 2860000, paymentsCollectedMinor: 1000000, refundsMinor: 50000, netCollectedMinor: 950000, roomsSold: 55, roomNightsAvailable: 780, occupancyPct: 7, adrMinor: 49800, revparMinor: 3500 },
  ];
  return {
    from: '2026-08-01',
    to: '2026-10-01',
    sellableRooms: 26,
    months,
    summary: {
      grossRevenueMinor: 4960000,
      roomRevenueMinor: 4740000,
      posRevenueMinor: 220000,
      netCollectedMinor: 2450000,
      refundsMinor: 50000,
      occupancyPct: 6,
      adrMinor: 49900,
      revparMinor: 3000,
      revenueMomPct: 24,
    },
  };
}

// recharts needs a non-zero layout size in jsdom; stub ResponsiveContainer's box.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 300 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AnalyticsSection', () => {
  it('renders KPI values and the MoM change from the analytics payload', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(analytics()))));
    render(<AnalyticsSection propertyId={PROPERTY_ID} />);

    expect(await screen.findByText('Performance analytics')).toBeInTheDocument();
    // Occupancy KPI and MoM badge come straight from the summary.
    await waitFor(() => expect(screen.getByText('6%')).toBeInTheDocument());
    expect(screen.getByText(/24% vs last month/)).toBeInTheDocument();
    // Chart card titles render.
    expect(screen.getByText(/Monthly revenue/)).toBeInTheDocument();
    expect(screen.getByText(/Occupancy & ADR/)).toBeInTheDocument();
    expect(screen.getByText('Revenue mix')).toBeInTheDocument();
  });

  it('shows a permission notice when the reports endpoint is forbidden', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ error: { code: 'forbidden', message: 'no' } }, false, 403))));
    render(<AnalyticsSection propertyId={PROPERTY_ID} />);

    expect(await screen.findByText(/Analytics require the reports permission/)).toBeInTheDocument();
  });
});
