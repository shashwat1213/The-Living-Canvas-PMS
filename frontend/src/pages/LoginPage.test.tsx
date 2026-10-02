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

  // Design lock: the two-column "front door" (branded deep-green hero panel +
  // focused sign-in form) is the signed-off login look. This test fails loudly
  // if future UI work removes the hero showcase, so the premium design can't
  // silently regress to a plain centered form.
  it('renders the branded split-screen front door (design lock)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: {} }, false, 401)));
    const { container } = renderLoginPage();

    // Left: branded hero showcase panel with its headline and proof points.
    const hero = container.querySelector('.auth-hero');
    expect(hero).not.toBeNull();
    expect(hero?.querySelector('.auth-hero-headline')?.textContent).toMatch(/Run every property/i);
    expect(hero?.querySelectorAll('.auth-hero-features li').length).toBeGreaterThanOrEqual(3);
    expect(hero?.querySelectorAll('.auth-hero-stat').length).toBeGreaterThanOrEqual(3);

    // Right: focused sign-in form with heading + both fields.
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
});
