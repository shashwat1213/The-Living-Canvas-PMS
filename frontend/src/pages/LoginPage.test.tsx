import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthContext';
import { LoginPage } from './LoginPage';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 401) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderLoginPage() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('LoginPage', () => {
  it('submits email and password and shows a server-provided error on failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: {} }, false, 401)) // silent refresh on mount
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'unauthorized', message: 'Invalid email or password.' } }, false, 401));
    vi.stubGlobal('fetch', fetchMock);

    renderLoginPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log in' })).not.toBeDisabled());

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('links to the signup page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: {} }, false, 401)));
    renderLoginPage();

    expect(await screen.findByRole('link', { name: 'Create one' })).toHaveAttribute('href', '/signup');
  });
});
