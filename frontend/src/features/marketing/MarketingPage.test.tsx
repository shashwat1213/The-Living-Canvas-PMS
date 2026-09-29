import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import { MarketingPage } from './MarketingPage';
import type { MarketingContent } from './types';

function makeToken(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function session(permissions: string[]) {
  return readSessionClaims(
    makeToken({ sub: 'u1', organizationId: 'org-1', permissions, roleNames: ['MANAGER'], grantedPropertyIds: ['prop-1'] }),
  );
}

function content(overrides: Partial<MarketingContent> = {}): MarketingContent {
  return {
    id: 'c1',
    propertyId: 'prop-1',
    format: 'SOCIAL_POST',
    status: 'DRAFT',
    tone: 'luxury',
    brief: 'A monsoon weekend getaway offer.',
    title: 'Seaside Villa social post',
    generatedBody: '✨ Escape the rains at Seaside Villa.',
    editedBody: null,
    body: '✨ Escape the rains at Seaside Villa.',
    isEdited: false,
    provider: 'stub',
    lastError: null,
    createdBy: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

/** Stubs the property + marketing list endpoints. `onRequest` records every
 * (method, url) so a test can assert the request the UI built. */
function stubApi(rows: MarketingContent[], onRequest?: (method: string, url: string) => void) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    onRequest?.(method, String(url));
    if (String(url).includes('/marketing/content')) {
      return Promise.resolve(
        jsonResponse({ content: rows, page: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 } }),
      );
    }
    // getProperty
    return Promise.resolve(jsonResponse({ id: 'prop-1', name: 'Seaside Villa', slug: 'seaside-villa' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(permissions: string[] = ['marketing:read', 'marketing:manage', 'marketing:approve']) {
  const value: AuthContextValue = {
    status: 'authenticated',
    session: session(permissions),
    login: vi.fn(),
    logout: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={['/app/properties/prop-1/marketing']}>
        <Routes>
          <Route path="/app/properties/:propertyId/marketing" element={<MarketingPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MarketingPage', () => {
  it('lists content with its status', async () => {
    stubApi([content(), content({ id: 'c2', title: 'A tagline', status: 'APPROVED', format: 'TAGLINE' })]);
    renderPage();

    expect(await screen.findByText('Seaside Villa social post')).toBeInTheDocument();
    expect(screen.getByText('A tagline')).toBeInTheDocument();
    expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a no-access state without loading content when the permission is missing', async () => {
    const calls: string[] = [];
    stubApi([], (_method, url) => calls.push(url));
    renderPage(['properties:read']);
    expect(await screen.findByText(/don't have access to the marketing studio/i)).toBeInTheDocument();
    // The content list is never requested (the read gate short-circuits it);
    // the property lookup is harmless and permission-independent.
    expect(calls.some((u) => u.includes('/marketing/content'))).toBe(false);
  });

  it('generates content by POSTing the brief', async () => {
    const reqs: { method: string; url: string }[] = [];
    stubApi([], (method, url) => reqs.push({ method, url }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate content' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Brief'), {
      target: { value: 'A festive dinner package for the holidays.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(reqs.some((r) => r.method === 'POST' && r.url.includes('/marketing/content'))).toBe(true);
    });
  });

  it('hides the Generate button for a read-only manager without manage', async () => {
    stubApi([]);
    renderPage(['marketing:read']);
    await screen.findByRole('heading', { name: 'Marketing Studio' });
    expect(screen.queryByRole('button', { name: 'Generate content' })).not.toBeInTheDocument();
  });

  it('opens a draft and offers Approve; approving POSTs to /approve', async () => {
    const reqs: { method: string; url: string }[] = [];
    stubApi([content()], (method, url) => reqs.push({ method, url }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(reqs.some((r) => r.method === 'POST' && r.url.endsWith('/c1/approve'))).toBe(true);
    });
  });

  it('does not offer Approve to a manager lacking marketing:approve', async () => {
    stubApi([content()]);
    renderPage(['marketing:read', 'marketing:manage']);

    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    // But manage actions are present.
    expect(within(dialog).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});
