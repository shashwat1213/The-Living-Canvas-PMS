import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PropertiesPage } from './PropertiesPage';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PropertiesPage', () => {
  it('shows an empty state when there are no properties yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ properties: [] })));

    render(
      <MemoryRouter>
        <PropertiesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No properties yet — add your first one above.')).toBeInTheDocument();
  });

  it('lists properties and links to their rooms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          properties: [{ id: 'prop-1', name: 'Main House', slug: 'main-house', timezone: 'UTC' }],
        }),
      ),
    );

    render(
      <MemoryRouter>
        <PropertiesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Main House')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage rooms' })).toHaveAttribute('href', '/app/properties/prop-1/rooms');
  });

  it('creates a property and reloads the list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ properties: [] })) // initial load
      .mockResolvedValueOnce(jsonResponse({ property: { id: 'prop-2', name: 'New House', slug: 'new-house' } }, true, 201)) // create
      .mockResolvedValueOnce(
        jsonResponse({ properties: [{ id: 'prop-2', name: 'New House', slug: 'new-house', timezone: 'UTC' }] }),
      ); // reload after create
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <PropertiesPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('No properties yet — add your first one above.')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Name (e.g. Main House)'), { target: { value: 'New House' } });
    fireEvent.change(screen.getByPlaceholderText('Slug (e.g. main-house)'), { target: { value: 'new-house' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));

    expect(await screen.findByText('New House')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shows an error message when loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'internal_error', message: 'Could not load properties.' } }, false, 500)),
    );

    render(
      <MemoryRouter>
        <PropertiesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load properties.');
  });
});
