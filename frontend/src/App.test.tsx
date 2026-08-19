import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from './App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the product name and an API status indicator', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true } as Response),
    );

    render(<App />, { wrapper: MemoryRouter });

    expect(screen.getByText('The Living Canvas PMS')).toBeInTheDocument();
    expect(await screen.findByText('API: online')).toBeInTheDocument();
  });

  it('links to login and signup', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true } as Response),
    );

    render(<App />, { wrapper: MemoryRouter });

    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Create an organization' })).toHaveAttribute('href', '/signup');
  });
});
