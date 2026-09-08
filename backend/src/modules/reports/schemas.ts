import { z } from 'zod';

/**
 * A calendar date (no time). Parsed to a UTC-midnight `Date` so a stay night
 * is the same instant regardless of server timezone — the project's date-only
 * convention, shared with the availability, reservations and rate-plans
 * modules.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD).')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Not a valid calendar date.' });

/**
 * Longest reporting window a single request may ask for, in nights. A year of
 * daily rows is a reasonable ceiling for a management report; anything longer
 * is a 400 rather than an unbounded computation.
 */
export const MAX_REPORT_NIGHTS = 366;

/**
 * The revenue/occupancy report window. `from` is inclusive, `to` is exclusive
 * — the same half-open convention as a reservation's `checkOut` (the guest
 * does not stay the `to` night, so it is not a reported night). Both required;
 * the window must be at least one night and capped at a year.
 */
export const reportQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.to > v.from, { message: '`to` must be after `from`.' })
  .refine((v) => (v.to.getTime() - v.from.getTime()) / 86_400_000 <= MAX_REPORT_NIGHTS, {
    message: `The reporting window must be ${MAX_REPORT_NIGHTS} nights or fewer.`,
  });

export type ReportQuery = z.infer<typeof reportQuerySchema>;
