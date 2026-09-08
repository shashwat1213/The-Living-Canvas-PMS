import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BookingDialog } from './BookingDialog';
import type { ReservationQuote } from './types';

const PROPERTY_ID = 'prop-1';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

const guests = {
  guests: [
    { id: 'guest-1', organizationId: 'org-1', firstName: 'Asha', lastName: 'Menon', email: 'asha@example.com', phone: null, notes: null, reservationCount: 0, createdAt: '', updatedAt: '' },
  ],
  page: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
};
const roomTypes = {
  roomTypes: [{ id: 'rt-1', propertyId: PROPERTY_ID, name: 'Deluxe King', code: 'DLX', description: null, isActive: true, roomCount: 3, createdAt: '', updatedAt: '' }],
  page: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
};
const ratePlans = {
  ratePlans: [{ id: 'rp-1', roomTypeId: 'rt-1', name: 'Best Available Rate', code: 'BAR', description: null, isRefundable: true, isActive: true, pricedDates: 30, createdAt: '', updatedAt: '' }],
  page: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
};

function stubApi(options: { quote?: ReservationQuote; onQuote?: (body: unknown) => void } = {}) {
  const quote: ReservationQuote = options.quote ?? {
    available: true,
    sellableRooms: 3,
    booked: 1,
    nights: 2,
    totalMinor: 900000,
    pricedNights: [
      { date: '2026-10-10', amountMinor: 450000 },
      { date: '2026-10-11', amountMinor: 450000 },
    ],
  };
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.includes('/quote')) {
      options.onQuote?.(init?.body ? JSON.parse(init.body as string) : undefined);
      return Promise.resolve(jsonResponse(quote));
    }
    if (url.includes('/guests')) return Promise.resolve(jsonResponse(guests));
    if (url.includes('/rate-plans')) return Promise.resolve(jsonResponse(ratePlans));
    if (url.includes('/room-types')) return Promise.resolve(jsonResponse(roomTypes));
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillBooking() {
  fireEvent.change(await screen.findByLabelText('Guest'), { target: { value: 'guest-1' } });
  fireEvent.change(screen.getByLabelText('Room type'), { target: { value: 'rt-1' } });
  // Rate plans load after the room type is chosen.
  await waitFor(() => expect(screen.getByRole('option', { name: /Best Available Rate/ })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Rate plan'), { target: { value: 'rp-1' } });
  fireEvent.change(screen.getByLabelText('Arrival'), { target: { value: '2026-10-10' } });
  fireEvent.change(screen.getByLabelText('Departure'), { target: { value: '2026-10-12' } });
}

describe('BookingDialog', () => {
  it('shows a live availability and price quote from the server', async () => {
    stubApi();
    render(<BookingDialog propertyId={PROPERTY_ID} onClose={vi.fn()} onBooked={vi.fn()} />);

    await fillBooking();

    expect(await screen.findByText('2 of 3 rooms free')).toBeInTheDocument();
    // ₹9,000.00 from 900000 paise.
    expect(screen.getByText(/9,000\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeEnabled();
  });

  it('blocks confirming when the server reports sold out', async () => {
    stubApi({
      quote: { available: false, sellableRooms: 1, booked: 1, nights: 2, totalMinor: 900000, pricedNights: [] },
    });
    render(<BookingDialog propertyId={PROPERTY_ID} onClose={vi.fn()} onBooked={vi.fn()} />);

    await fillBooking();

    expect(await screen.findByText('Sold out for these dates')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeDisabled();
  });

  it('never quotes before a guest, room type, plan and dates are all chosen', async () => {
    let quoteBodies = 0;
    stubApi({ onQuote: () => (quoteBodies += 1) });
    render(<BookingDialog propertyId={PROPERTY_ID} onClose={vi.fn()} onBooked={vi.fn()} />);

    // Choose only the room type — not enough to price.
    fireEvent.change(await screen.findByLabelText('Room type'), { target: { value: 'rt-1' } });
    await new Promise((r) => setTimeout(r, 400));
    expect(quoteBodies).toBe(0);
  });
});
