import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardPage } from './DashboardPage';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  it('shows a loading state before the organization/property data resolves', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    renderDashboard();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('welcomes the org by name and shows a real (not fabricated) property count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/organizations/me')) {
          return Promise.resolve(jsonResponse({ organization: { id: 'org-1', name: 'Canvas Test Hotel' } }));
        }
        return Promise.resolve(
          jsonResponse({ properties: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] }),
        );
      }),
    );

    renderDashboard();

    expect(await screen.findByText('Welcome, Canvas Test Hotel')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // "Properties" also appears in the note's link below the card, so
    // scope this assertion to the summary card specifically.
    expect(screen.getByText('Properties', { selector: '.dashboard-card-label' })).toBeInTheDocument();
  });

  it('shows the singular label for exactly one property', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/organizations/me')) {
          return Promise.resolve(jsonResponse({ organization: { id: 'org-1', name: 'Solo Hotel' } }));
        }
        return Promise.resolve(jsonResponse({ properties: [{ id: 'p1' }] }));
      }),
    );

    renderDashboard();

    expect(await screen.findByText('Property')).toBeInTheDocument();
  });

  it('does not invent occupancy/revenue data — only names modules not yet built', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/organizations/me')) {
          return Promise.resolve(jsonResponse({ organization: { id: 'org-1', name: 'Canvas Test Hotel' } }));
        }
        return Promise.resolve(jsonResponse({ properties: [] }));
      }),
    );

    renderDashboard();

    expect(await screen.findByText(/Occupancy, revenue, and booking activity will appear here/)).toBeInTheDocument();
  });

  it('shows an error state when the dashboard data fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'internal_error', message: 'Could not load your dashboard.' } }, false, 500)),
    );

    renderDashboard();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your dashboard.');
  });
});
