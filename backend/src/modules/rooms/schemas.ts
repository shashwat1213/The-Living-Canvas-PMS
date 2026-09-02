import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

const roomStatus = z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']);

/**
 * A room's category is a reference into this property's RoomType
 * catalogue — the model every commercial PMS uses (Mews, Cloudbeds,
 * Stayntouch): rooms are assigned a type from a managed list, never free
 * text. The free-text `roomType` this replaced was dropped in migration
 * `20260902000200_rooms_catalogue_only`. The id is validated against the
 * room's own property inside the write transaction (see `rooms/service.ts`),
 * which is what stops a caller pointing a room at another tenant's type.
 */
export const createRoomSchema = z.object({
  name: z.string().min(1).max(40),
  roomTypeId: z.string().uuid(),
  floor: z.string().max(20).optional(),
  capacity: z.number().int().min(1).max(50).optional(),
  status: roomStatus.optional(),
  notes: z.string().max(1000).optional(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

/**
 * Update leaves every field optional — a room already has a type, and a
 * caller may be changing only its status. `roomTypeId` is re-assignable
 * but never clearable: there is no valid "untyped room" state, so it is
 * not `.nullable()`.
 */
export const updateRoomSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  roomTypeId: z.string().uuid().optional(),
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
