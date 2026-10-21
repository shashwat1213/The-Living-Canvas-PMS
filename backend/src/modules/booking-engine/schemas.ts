import { z } from 'zod';

/**
 * Date-only, parsed to UTC midnight — the project's shared stay-date
 * convention (same as reservations/availability).
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD).')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Not a valid calendar date.' });

/**
 * A public availability search for a property: a date window and an optional
 * party size. `checkOut` is exclusive (half-open), at least one night, capped
 * at 30 nights so an anonymous caller can't ask the server for an unbounded
 * price computation.
 */
export const searchQuerySchema = z
  .object({
    checkIn: isoDate,
    checkOut: isoDate,
    adults: z.coerce.number().int().min(1).max(20).optional(),
    children: z.coerce.number().int().min(0).max(20).optional(),
  })
  .refine((v) => v.checkOut > v.checkIn, { message: '`checkOut` must be after `checkIn`.' })
  .refine((v) => (v.checkOut.getTime() - v.checkIn.getTime()) / 86_400_000 <= 30, {
    message: 'The stay window must be 30 nights or fewer.',
  });

export type SearchQuery = z.infer<typeof searchQuerySchema>;

const guestEmail = z.string().trim().toLowerCase().email().max(200);
const guestPhone = z.string().trim().min(3).max(40);

/**
 * A public booking request. The guest identifies themselves by name + at least
 * one contact method (so the confirmation can reach them), picks a room type +
 * rate plan returned by search, and a stay window. No auth: the property is
 * addressed by its public slug in the route, the org is resolved server-side,
 * and pricing/availability are re-validated and re-priced at booking time — the
 * client's quoted price is never trusted.
 */
export const bookRequestSchema = z
  .object({
    roomTypeId: z.string().uuid(),
    ratePlanId: z.string().uuid(),
    checkIn: isoDate,
    checkOut: isoDate,
    adults: z.coerce.number().int().min(1).max(20).optional(),
    children: z.coerce.number().int().min(0).max(20).optional(),
    guest: z
      .object({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        email: guestEmail.optional(),
        phone: guestPhone.optional(),
      })
      .refine((g) => Boolean(g.email || g.phone), {
        message: 'Provide an email or a phone number so we can send your confirmation.',
      }),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.checkOut > v.checkIn, { message: '`checkOut` must be after `checkIn`.' })
  .refine((v) => (v.checkOut.getTime() - v.checkIn.getTime()) / 86_400_000 <= 30, {
    message: 'The stay window must be 30 nights or fewer.',
  });

export type BookRequest = z.infer<typeof bookRequestSchema>;
