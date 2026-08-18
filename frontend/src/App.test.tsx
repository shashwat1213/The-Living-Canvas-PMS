import { render, screen } from '@testing-library/react';
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

    render(<App />);

    expect(screen.getByText('The Living Canvas PMS')).toBeInTheDocument();
    expect(await screen.findByText('API: online')).toBeInTheDocument();
  });
});
