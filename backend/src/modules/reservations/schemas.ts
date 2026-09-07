import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

/**
 * A calendar date (no time). Parsed to a UTC-midnight `Date` so a stay night
 * is the same instant regardless of server timezone — the project's date-only
 * stay-date convention, shared with the rate-plans module.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD).')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Not a valid calendar date.' });

/**
 * Create a booking. The guest, room type and rate plan are referenced by id;
 * the server validates each against the property and computes the price from
 * the rate plan's per-date rates — the client never sends money.
 *
 * `checkOut` is exclusive (the guest does not stay that night), so a booking
 * must be at least one night. Capped at 370 nights so a single request can't
 * ask the server to price an unbounded stay.
 */
export const createReservationSchema = z
  .object({
    guestId: z.string().uuid(),
    roomTypeId: z.string().uuid(),
    ratePlanId: z.string().uuid(),
    checkIn: isoDate,
    checkOut: isoDate,
    adults: z.number().int().min(1).max(30).optional(),
    children: z.number().int().min(0).max(30).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.checkOut > v.checkIn, { message: '`checkOut` must be after `checkIn`.' })
  .refine((v) => (v.checkOut.getTime() - v.checkIn.getTime()) / 86_400_000 <= 370, {
    message: 'A stay must be 370 nights or fewer.',
  });

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

/** Cancellation carries an optional reason, recorded on the reservation. */
export const cancelReservationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;

export const RESERVATION_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as const;

/**
 * List filters. `status` narrows by lifecycle state; `from`/`to` find
 * reservations whose stay *overlaps* that window (arrivals, in-house, and
 * departures in a date range — the query a front desk actually runs), and
 * `search` matches the guest name or the booking reference.
 */
export const listReservationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RESERVATION_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type ListReservationsQuery = z.infer<typeof listReservationsQuerySchema>;
