import { z } from 'zod';

/**
 * A calendar date (no time). Parsed to a UTC-midnight `Date` so a stay night
 * is the same instant regardless of server timezone — the project's date-only
 * stay-date convention, shared with the reservations and rate-plans modules.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD).')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Not a valid calendar date.' });

/** Longest availability window a single request may ask for, in nights. */
const MAX_WINDOW_NIGHTS = 62;

/**
 * The availability window. `from` is inclusive, `to` is exclusive — the same
 * half-open convention as a reservation's `checkOut` (the guest does not stay
 * the `to` night). Both are required. The window must be at least one night
 * (`to` after `from`) and capped at 62 nights so a single request can't ask
 * the server to compute an unbounded grid.
 */
export const availabilityQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.to > v.from, { message: '`to` must be after `from`.' })
  .refine((v) => (v.to.getTime() - v.from.getTime()) / 86_400_000 <= MAX_WINDOW_NIGHTS, {
    message: `The availability window must be ${MAX_WINDOW_NIGHTS} nights or fewer.`,
  });

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
