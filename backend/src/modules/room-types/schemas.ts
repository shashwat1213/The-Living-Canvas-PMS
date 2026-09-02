import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

/**
 * A short operational code ("DLXK", "STD"). Upper-cased on the way in so
 * the per-property uniqueness constraint can't be sidestepped by casing —
 * "dlxk" and "DLXK" are the same code to everyone who reads a rooming
 * list, and the database would otherwise happily hold both.
 */
const roomTypeCode = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers or hyphens only.')
  .transform((value) => value.toUpperCase());

export const createRoomTypeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: roomTypeCode.optional(),
  description: z.string().trim().max(1000).optional(),
  isActive: z.boolean().optional(),
});

export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>;

/**
 * Update differs from create in one way: `code` and `description` accept
 * `null`, not just a value or absence. `create` has nothing to clear, so
 * there both stay `.optional()` only — but once set, the sole way to
 * remove a code or description is to send `null` explicitly, and a schema
 * that rejected it (2d's limitation) left those fields write-once. The DB
 * columns are already nullable; this is the validation half of allowing a
 * clear. An omitted key still means "leave unchanged"; `null` means
 * "clear it".
 */
export const updateRoomTypeSchema = createRoomTypeSchema
  .extend({
    code: roomTypeCode.nullable(),
    description: z.string().trim().max(1000).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update.' });

export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>;

/**
 * `status` mirrors the staff module's active/inactive pair rather than
 * rooms' three-way `RoomStatus`: a room type is either sellable or
 * retired, and there is no maintenance state for a catalogue entry.
 */
export const listRoomTypesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type ListRoomTypesQuery = z.infer<typeof listRoomTypesQuerySchema>;
