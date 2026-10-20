import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { AuthProvider } from './auth/AuthContext';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderHome() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response));
  return render(
    <AuthProvider>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('App (public landing page)', () => {
  it('presents the product with a clear headline and feature list', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/Run every property/);
    expect(screen.getByRole('heading', { name: 'Tape-chart calendar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AI assistant & marketing' })).toBeInTheDocument();
  });

  it('offers the live demo, sign-up and login', async () => {
    renderHome();
    expect(await screen.findByRole('link', { name: /Try the live demo/ })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Start free' })).toHaveAttribute('href', '/signup');
    expect(screen.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute('href', '/login');
  });

  it('links to the privacy policy and terms from the footer', async () => {
    renderHome();
    expect(await screen.findByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
  });
});
