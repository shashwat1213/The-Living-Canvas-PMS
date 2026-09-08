import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GuestProfileDialog } from './GuestProfileDialog';
import type { Guest, GuestProfile } from './types';

const GUEST: Guest = {
  id: 'guest-1',
  organizationId: 'org-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: null,
  notes: null,
  tags: ['VIP'],
  reservationCount: 2,
  createdAt: '',
  updatedAt: '',
};

function profile(overrides: Partial<GuestProfile> = {}): GuestProfile {
  return {
    guest: GUEST,
    stats: {
      totalStays: 2,
      upcomingStays: 0,
      cancelledStays: 0,
      nightsStayed: 3,
      bookedValueMinor: 1200000,
      chargedMinor: 800000,
      paidMinor: 500000,
      balanceMinor: 300000,
      isRepeatGuest: true,
      firstStay: '2026-10-10',
      lastStay: '2026-10-14',
    },
    stays: [
      {
        id: 'r1',
        reference: 'LC-001',
        status: 'CHECKED_OUT',
        property: { id: 'p1', name: 'Seaside Villa' },
        roomType: { id: 'rt1', name: 'Deluxe King' },
        checkIn: '2026-10-14',
        checkOut: '2026-10-15',
        nights: 1,
        totalAmountMinor: 400000,
      },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function stubApi(options: { onSetTags?: (body: unknown) => void; profileData?: GuestProfile } = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('/tags') && init?.method === 'PUT') {
      options.onSetTags?.(JSON.parse(String(init.body)));
      return Promise.resolve(jsonResponse({ guest: { ...GUEST, tags: ['VIP', 'CORPORATE'] } }));
    }
    if (url.includes('/profile')) {
      return Promise.resolve(jsonResponse(options.profileData ?? profile()));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GuestProfileDialog', () => {
  it('shows lifetime stats, the repeat-guest badge and stay history', async () => {
    stubApi();
    render(<GuestProfileDialog guest={GUEST} canManage onClose={vi.fn()} onTagsChanged={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('Repeat guest')).toBeInTheDocument();
    // Nights stayed stat.
    expect(screen.getByText('3')).toBeInTheDocument();
    // A money stat formatted from paise (₹12,000 booked value).
    expect(screen.getByText(/₹12,000/)).toBeInTheDocument();
    // The stay-history row.
    const row = screen.getByRole('row', { name: /LC-001/ });
    expect(within(row).getByText('Seaside Villa')).toBeInTheDocument();
  });

  it('adds and saves a tag, sending the full set to the API', async () => {
    const bodies: unknown[] = [];
    stubApi({ onSetTags: (b) => bodies.push(b) });
    const onTagsChanged = vi.fn();
    render(<GuestProfileDialog guest={GUEST} canManage onClose={vi.fn()} onTagsChanged={onTagsChanged} />);

    await screen.findByRole('heading', { name: 'Ada Lovelace' });

    fireEvent.change(screen.getByPlaceholderText(/Add a tag/), { target: { value: 'corporate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /Save tags/ }));

    await waitFor(() => expect(bodies.length).toBe(1));
    // Tag is upper-cased in the UI before sending, and the whole set is sent.
    expect(bodies[0]).toEqual({ tags: ['VIP', 'CORPORATE'] });
    await waitFor(() => expect(onTagsChanged).toHaveBeenCalled());
  });

  it('hides tag editing when the user cannot manage', async () => {
    stubApi();
    render(<GuestProfileDialog guest={GUEST} canManage={false} onClose={vi.fn()} onTagsChanged={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    // The existing tag shows, but there's no add-tag input.
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Add a tag/)).not.toBeInTheDocument();
  });
});
