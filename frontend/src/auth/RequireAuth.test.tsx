import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from './AuthContext';
import { RequireAuth } from './RequireAuth';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 401) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string, ok: boolean) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(ok ? { accessToken: 't' } : { error: {} }, ok, ok ? 200 : 401)));

  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div>login screen</div>} />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <div>protected content</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('RequireAuth', () => {
  it('redirects to /login when the session is anonymous', async () => {
    renderAt('/app', false);
    await waitFor(() => expect(screen.getByText('login screen')).toBeInTheDocument());
  });

  it('renders the protected content when authenticated', async () => {
    renderAt('/app', true);
    await waitFor(() => expect(screen.getByText('protected content')).toBeInTheDocument());
  });
});
