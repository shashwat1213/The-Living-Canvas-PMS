import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

/**
 * A guest profile. Name is required — a booking needs someone to be under —
 * but contact details are optional: a walk-in booked at the desk may give a
 * name and nothing else, and the PMS must still be able to house them.
 *
 * Email, when given, is validated and lower-cased so "Ann@x.com" and
 * "ann@x.com" are recognised as the same person for the duplicate check the
 * service runs; it is not a hard unique constraint (see the Guest model).
 */
const guestEmail = z.string().trim().toLowerCase().email().max(200);
const guestPhone = z.string().trim().min(3).max(40);

export const createGuestSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: guestEmail.optional(),
  phone: guestPhone.optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateGuestInput = z.infer<typeof createGuestSchema>;

/**
 * Update makes contact fields `.nullable()` so a value can be cleared with an
 * explicit `null`, while an omitted key means "leave unchanged". Names stay
 * required-when-present — a guest cannot be nameless. At least one field.
 */
export const updateGuestSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: guestEmail.nullable(),
    phone: guestPhone.nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update.' });

export type UpdateGuestInput = z.infer<typeof updateGuestSchema>;

export const listGuestsQuerySchema = paginationQuerySchema.extend({
  /** Matches across first name, last name, email and phone. */
  search: z.string().trim().max(120).optional(),
});

export type ListGuestsQuery = z.infer<typeof listGuestsQuerySchema>;
