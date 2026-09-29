import { z } from 'zod';

/**
 * A calendar date (no time), parsed to UTC-midnight — the project's date-only
 * stay-date convention, shared with the reservations module.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD).')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Not a valid calendar date.' });

/**
 * One room within a block. Same shape as a standalone booking's core fields —
 * a room type, a rate plan, a guest and a stay window — because each line
 * becomes an ordinary child `Reservation`. Rooms in a block may have different
 * types, rate plans, guests and even dates: a wedding party books three
 * Deluxe rooms for the weekend and one Suite for the couple across a longer
 * stay, all under one block.
 */
const blockRoomSchema = z
  .object({
    roomTypeId: z.string().uuid(),
    ratePlanId: z.string().uuid(),
    guestId: z.string().uuid(),
    checkIn: isoDate,
    checkOut: isoDate,
    adults: z.number().int().min(1).max(30).optional(),
    children: z.number().int().min(0).max(30).optional(),
  })
  .refine((v) => v.checkOut > v.checkIn, { message: '`checkOut` must be after `checkIn`.' })
  .refine((v) => (v.checkOut.getTime() - v.checkIn.getTime()) / 86_400_000 <= 370, {
    message: 'A stay must be 370 nights or fewer.',
  });

/**
 * Create a block: a named group plus one-or-more rooms booked together. The
 * whole block is all-or-nothing — if any room can't be priced or has no
 * availability, none are created and the block isn't opened.
 */
export const createReservationGroupSchema = z.object({
  name: z.string().trim().min(1, 'A block needs a name.').max(200),
  contactGuestId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  rooms: z.array(blockRoomSchema).min(1, 'A block needs at least one room.').max(50, 'A block is capped at 50 rooms.'),
});

export type CreateReservationGroupInput = z.infer<typeof createReservationGroupSchema>;

/** Cancel a whole block: an optional reason, applied to every child booking. */
export const cancelReservationGroupSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type CancelReservationGroupInput = z.infer<typeof cancelReservationGroupSchema>;
