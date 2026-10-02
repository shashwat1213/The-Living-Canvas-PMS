import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims, type SessionClaims } from '../../auth/session';
import { AssistantWidget } from './AssistantWidget';

function makeToken(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function session(permissions: string[]): SessionClaims | null {
  return readSessionClaims(
    makeToken({ sub: 'u1', organizationId: 'org-1', permissions, roleNames: ['MANAGER'], grantedPropertyIds: ['prop-1'] }),
  );
}

function authValue(claims: SessionClaims | null): AuthContextValue {
  return {
    status: 'authenticated',
    session: claims,
    login: vi.fn(),
    logout: vi.fn(),
  } as unknown as AuthContextValue;
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

/** Render the widget on a property-scoped route (default) or a non-property
 * route, with a given session. */
function renderWidget({
  claims = session(['dashboard:read']),
  path = '/app/properties/prop-1/dashboard',
  route = '/app/properties/:propertyId/dashboard',
}: { claims?: SessionClaims | null; path?: string; route?: string } = {}) {
  return render(
    <AuthContext.Provider value={authValue(claims)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={<AssistantWidget />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AssistantWidget', () => {
  it('renders nothing without a propertyId in the route', () => {
    const { container } = renderWidget({ path: '/app/guests', route: '/app/guests' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing without dashboard:read permission', () => {
    const { container } = renderWidget({ claims: session([]) });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the launcher and opens the drawer with suggestions', () => {
    renderWidget();
    const fab = screen.getByRole('button', { name: 'Open assistant' });
    fireEvent.click(fab);
    expect(screen.getByRole('dialog', { name: 'Property assistant' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "What's our occupancy today?" })).toBeInTheDocument();
  });

  it('sends a message and renders the assistant reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ reply: 'Occupancy is 72% today.', provider: 'groq:qwen/qwen3.8-27b' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }));

    fireEvent.change(screen.getByLabelText('Message the assistant'), {
      target: { value: 'What is our occupancy?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    // User message echoed, then the reply arrives.
    expect(screen.getByText('What is our occupancy?')).toBeInTheDocument();
    expect(await screen.findByText('Occupancy is 72% today.')).toBeInTheDocument();

    // It POSTed to the property-scoped assistant endpoint.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/properties/prop-1/assistant/chat');
    expect(init.method).toBe('POST');
  });

  it('clicking a suggestion sends it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ reply: 'Three guests arrive today.', provider: 'stub' }));
    vi.stubGlobal('fetch', fetchMock);

    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Who is arriving today?' }));

    expect(await screen.findByText('Three guests arrive today.')).toBeInTheDocument();
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'Who is arriving today?' });
  });

  it('shows an error message when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'server_error', message: 'Boom.' } }, false, 500)));

    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }));
    fireEvent.change(screen.getByLabelText('Message the assistant'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom.');
  });
});
