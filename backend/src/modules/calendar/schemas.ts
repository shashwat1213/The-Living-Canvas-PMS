import { z } from 'zod';

/**
 * A calendar date (no time). Parsed to a UTC-midnight `Date` so a stay night
 * is the same instant regardless of server timezone — the project's date-only
 * stay-date convention, shared with the reservations, rate-plans and
 * availability modules.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD).')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Not a valid calendar date.' });

/**
 * Longest calendar window a single request may ask for, in nights. The tape
 * chart renders one column per night per room, so the payload and the DOM both
 * grow with the window — 62 nights (two months) is a generous operational
 * horizon and the same cap the availability grid uses.
 */
const MAX_WINDOW_NIGHTS = 62;

/**
 * The calendar window. `from` is inclusive, `to` is exclusive — the same
 * half-open convention as a reservation's `checkOut` (the guest does not stay
 * the `to` night). Both required; the window must be at least one night and is
 * capped so a single request can't ask the server to compute an unbounded grid.
 */
export const calendarQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.to > v.from, { message: '`to` must be after `from`.' })
  .refine((v) => (v.to.getTime() - v.from.getTime()) / 86_400_000 <= MAX_WINDOW_NIGHTS, {
    message: `The calendar window must be ${MAX_WINDOW_NIGHTS} nights or fewer.`,
  });

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
