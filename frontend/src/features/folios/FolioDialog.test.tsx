import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FolioDialog } from './FolioDialog';
import type { Folio } from './types';

const PROPERTY_ID = 'prop-1';
const RESERVATION_ID = 'res-1';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function folio(overrides: Partial<Folio> = {}): Folio {
  const charges = overrides.charges ?? [
    { id: 'c1', description: 'Room charge — booking LC-1', amountMinor: 900000, createdAt: '2026-10-01T00:00:00.000Z' },
  ];
  const payments = overrides.payments ?? [];
  const chargesTotalMinor = charges.reduce((a, c) => a + c.amountMinor, 0);
  const paymentsTotalMinor = payments.reduce((a, p) => a + p.amountMinor, 0);
  return {
    id: 'folio-1',
    reservationId: RESERVATION_ID,
    status: 'OPEN',
    closedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    reservation: {
      id: RESERVATION_ID,
      reference: 'LC-1',
      totalAmountMinor: 900000,
      guest: { id: 'g1', firstName: 'Ada', lastName: 'Lovelace' },
    },
    charges,
    payments,
    chargesTotalMinor,
    paymentsTotalMinor,
    balanceMinor: chargesTotalMinor - paymentsTotalMinor,
    ...overrides,
  };
}

function stubApi(options: { initial?: Folio; onMutate?: (url: string, body: unknown) => Folio } = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const result = options.onMutate ? options.onMutate(url, body) : folio();
      return Promise.resolve(jsonResponse({ folio: result }));
    }
    return Promise.resolve(jsonResponse({ folio: options.initial ?? folio() }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FolioDialog', () => {
  it('loads and shows the bill with the room charge and a derived balance due', async () => {
    stubApi();
    render(<FolioDialog propertyId={PROPERTY_ID} reservationId={RESERVATION_ID} reference="LC-1" mayManage onClose={vi.fn()} />);

    expect(await screen.findByText('Room charge — booking LC-1')).toBeInTheDocument();
    expect(screen.getByText('Balance due')).toBeInTheDocument();
    // ₹9,000.00 from 900000 paise appears (charge + balance).
    expect(screen.getAllByText(/9,000\.00/).length).toBeGreaterThan(0);
  });

  it('records a payment, posting rupees converted to paise', async () => {
    let paidBody: unknown;
    stubApi({
      onMutate: (url, body) => {
        if (url.includes('/payments')) {
          paidBody = body;
          return folio({ payments: [{ id: 'p1', method: 'CARD', amountMinor: 900000, reference: null, note: null, createdAt: '' }] });
        }
        return folio();
      },
    });
    render(<FolioDialog propertyId={PROPERTY_ID} reservationId={RESERVATION_ID} reference="LC-1" mayManage onClose={vi.fn()} />);

    await screen.findByText('Room charge — booking LC-1');
    fireEvent.change(screen.getByLabelText('Payment amount in rupees'), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));

    await waitFor(() => {
      expect(paidBody).toMatchObject({ method: 'CASH', amountMinor: 900000 });
    });
    // Now settled.
    expect(await screen.findByText('Settled')).toBeInTheDocument();
  });

  it('disables Close while a balance is outstanding', async () => {
    stubApi();
    render(<FolioDialog propertyId={PROPERTY_ID} reservationId={RESERVATION_ID} reference="LC-1" mayManage onClose={vi.fn()} />);

    await screen.findByText('Room charge — booking LC-1');
    expect(screen.getByRole('button', { name: 'Close folio' })).toBeDisabled();
  });

  it('hides posting forms and close/reopen from a read-only user', async () => {
    stubApi();
    render(<FolioDialog propertyId={PROPERTY_ID} reservationId={RESERVATION_ID} reference="LC-1" mayManage={false} onClose={vi.fn()} />);

    await screen.findByText('Room charge — booking LC-1');
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close folio' })).not.toBeInTheDocument();
  });

  it('offers Reopen on a closed folio instead of the posting forms', async () => {
    stubApi({ initial: folio({ status: 'CLOSED', closedAt: '2026-10-03T00:00:00.000Z', payments: [{ id: 'p1', method: 'CASH', amountMinor: 900000, reference: null, note: null, createdAt: '' }] }) });
    render(<FolioDialog propertyId={PROPERTY_ID} reservationId={RESERVATION_ID} reference="LC-1" mayManage onClose={vi.fn()} />);

    await screen.findByText('Room charge — booking LC-1');
    expect(screen.getByRole('button', { name: 'Reopen folio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
  });
});
