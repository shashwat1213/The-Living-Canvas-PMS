import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BookingPage } from './BookingPage';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

const PROPERTY = {
  slug: 'grand-palace',
  name: 'Grand Palace',
  addressLine1: 'Marine Drive',
  city: 'Mumbai',
  region: 'Maharashtra',
  country: 'India',
};

const OPTION = {
  roomTypeId: 'rt-1',
  roomTypeName: 'Deluxe King',
  description: 'Sea view',
  ratePlanId: 'rp-1',
  ratePlanName: 'Best Available Rate',
  nights: 2,
  totalMinor: 900000,
  avgNightlyMinor: 450000,
  roomsLeft: 3,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/book/grand-palace']}>
      <Routes>
        <Route path="/book/:slug" element={<BookingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BookingPage', () => {
  it('loads the property and runs a full search → select → book flow', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.endsWith('/book/grand-palace')) return Promise.resolve(jsonResponse({ property: PROPERTY }));
      if (u.includes('/search')) return Promise.resolve(jsonResponse({ property: PROPERTY, checkIn: '2026-10-10', checkOut: '2026-10-12', options: [OPTION] }));
      if (u.includes('/book') && method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              confirmation: {
                reference: 'LC-ABC123',
                propertyName: 'Grand Palace',
                roomTypeName: 'Deluxe King',
                checkIn: '2026-10-10',
                checkOut: '2026-10-12',
                nights: 2,
                totalMinor: 900000,
                guestName: 'Grace Hopper',
              },
            },
            true,
            201,
          ),
        );
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    // Property name loads in the hero.
    expect(await screen.findByRole('heading', { name: 'Grand Palace' })).toBeInTheDocument();

    // Search.
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Deluxe King')).toBeInTheDocument();
    expect(screen.getByText('3 rooms left')).toBeInTheDocument();

    // Select the room → guest form appears.
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(await screen.findByRole('heading', { name: 'Your details' })).toBeInTheDocument();

    // Fill guest + confirm.
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Hopper' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'grace@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm booking/ }));

    // Confirmation view.
    expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeInTheDocument();
    expect(screen.getByText('LC-ABC123')).toBeInTheDocument();
  });

  it('shows an error when the property does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'Property not found.' } }, false, 404)));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Property not found' })).toBeInTheDocument();
  });

  it('shows a message when no rooms are available', async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/search')) return Promise.resolve(jsonResponse({ property: PROPERTY, checkIn: 'x', checkOut: 'y', options: [] }));
      return Promise.resolve(jsonResponse({ property: PROPERTY }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByRole('heading', { name: 'Grand Palace' });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/No rooms available/)).toBeInTheDocument();
  });
});
