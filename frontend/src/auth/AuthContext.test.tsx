import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from './AuthContext';
import { useAuth } from './useAuth';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 401) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function Probe() {
  const { status, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <button onClick={() => void login('owner@example.com', 'password123')}>login</button>
      {/* logout() intentionally rethrows after clearing local state (see
          AuthContext.tsx) so a real caller can surface the failure —
          mirroring AppShell's own catch here rather than letting it
          escape as an unhandled rejection in the test. */}
      <button onClick={() => void logout().catch(() => {})}>logout</button>
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthProvider', () => {
  it('starts loading, then becomes anonymous when the silent refresh fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'unauthorized', message: 'no session' } }, false, 401)),
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
  });

  it('becomes authenticated when the silent refresh succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ accessToken: 'token-abc' })));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
  });

  it('login() moves status to authenticated', async () => {
    const fetchMock = vi
      .fn()
      // Initial silent refresh on mount fails.
      .mockResolvedValueOnce(jsonResponse({ error: {} }, false, 401))
      // login() call succeeds.
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'token-xyz', user: { email: 'owner@example.com' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));

    await act(async () => {
      screen.getByText('login').click();
    });

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
  });

  it('logout() moves status back to anonymous even if the request fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'token-abc' })) // silent refresh
      .mockResolvedValueOnce(jsonResponse({ error: {} }, false, 500)); // logout fails server-side
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

    await act(async () => {
      screen.getByText('logout').click();
    });

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
  });
});
