/**
 * Domain types for folios (guest bills), mirroring what
 * `backend/src/modules/folios` returns. All money is integer INR minor units
 * (paise). The balance is derived server-side (charges − payments), never
 * stored, so the client always renders what the server computed.
 */

export const PAYMENT_METHODS = ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
};

export interface FolioCharge {
  id: string;
  description: string;
  amountMinor: number;
  createdAt: string;
}

export interface FolioPayment {
  id: string;
  method: PaymentMethod;
  amountMinor: number;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export interface Folio {
  id: string;
  reservationId: string;
  status: 'OPEN' | 'CLOSED';
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reservation: {
    id: string;
    reference: string;
    totalAmountMinor: number;
    guest: { id: string; firstName: string; lastName: string };
  };
  charges: FolioCharge[];
  payments: FolioPayment[];
  chargesTotalMinor: number;
  paymentsTotalMinor: number;
  /** charges − payments. Positive: the guest owes. Negative: a refund is due. */
  balanceMinor: number;
}

export interface AddChargeInput {
  description: string;
  amountMinor: number;
}

export interface AddPaymentInput {
  method: PaymentMethod;
  amountMinor: number;
  reference?: string;
  note?: string;
}
