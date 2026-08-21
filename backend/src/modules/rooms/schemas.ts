import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

const roomStatus = z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']);

/**
 * A room's category, in the two forms the API currently accepts.
 *
 * `roomType` is the original free text and stays required-in-effect for
 * backward compatibility: every existing client sends it, and nothing
 * that worked before this slice may stop working. `roomTypeId` is the
 * structured replacement — when it is supplied without `roomType`, the
 * service fills the legacy label in from the type's name so the two
 * representations never disagree (see `rooms/service.ts`).
 *
 * At least one of them is required on create, which is what keeps
 * `roomType` NOT NULL satisfied without forcing new clients to send a
 * label they no longer own.
 */
const roomTypeFields = {
  roomType: z.string().min(1).max(80).optional(),
  /** `null` clears the link; omitted leaves it untouched. */
  roomTypeId: z.string().uuid().nullable().optional(),
};

export const createRoomSchema = z
  .object({
    name: z.string().min(1).max(40),
    ...roomTypeFields,
    floor: z.string().max(20).optional(),
    capacity: z.number().int().min(1).max(50).optional(),
    status: roomStatus.optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((value) => value.roomType !== undefined || typeof value.roomTypeId === 'string', {
    message: 'Provide either roomType or roomTypeId.',
    path: ['roomType'],
  });

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

/**
 * `.partial()` can't be called on a refined schema, so the update shape is
 * declared from the same field set rather than derived. Update has no
 * "one of the two is required" rule — a room already has a label.
 */
export const updateRoomSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  ...roomTypeFields,
  floor: z.string().max(20).optional(),
  capacity: z.number().int().min(1).max(50).optional(),
  status: roomStatus.optional(),
  notes: z.string().max(1000).optional(),
});

export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

/**
 * Query parameters for `GET /properties/:propertyId/rooms`. Status is the
 * filter a front desk actually reaches for ("what's in maintenance?"),
 * so it takes the full `RoomStatus` enum rather than the active/inactive
 * pair the other modules use.
 */
export const listRoomsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: roomStatus.optional(),
});

export type ListRoomsQuery = z.infer<typeof listRoomsQuerySchema>;
