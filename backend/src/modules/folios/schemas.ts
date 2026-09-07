import { z } from 'zod';

/** Payment methods the front desk can record. Manual entry only — no gateway. */
export const PAYMENT_METHODS = ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'OTHER'] as const;

/**
 * Post a manual charge line to a folio (a minibar item, late-checkout fee, or
 * a negative correction). `amountMinor` is INR paise; it may be negative for a
 * correction/discount but not zero. Room charges are auto-posted when the folio
 * opens and are not created through this path.
 */
export const addChargeSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amountMinor: z
    .number()
    .int('Amount must be a whole number of paise.')
    .refine((n) => n !== 0, { message: 'A charge cannot be zero.' })
    .refine((n) => Math.abs(n) <= 100_000_000, { message: 'Amount is out of range.' }),
});

export type AddChargeInput = z.infer<typeof addChargeSchema>;

/**
 * Record a payment (or, with a negative amount, a refund) against a folio.
 * `reference` is a free-text external id (card auth code, UPI txn id) — never a
 * stored credential.
 */
export const addPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountMinor: z
    .number()
    .int('Amount must be a whole number of paise.')
    .refine((n) => n !== 0, { message: 'A payment cannot be zero.' })
    .refine((n) => Math.abs(n) <= 100_000_000, { message: 'Amount is out of range.' }),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export type AddPaymentInput = z.infer<typeof addPaymentSchema>;
