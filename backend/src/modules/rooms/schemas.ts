import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

const roomStatus = z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']);

export const createRoomSchema = z.object({
  name: z.string().min(1).max(40),
  roomType: z.string().min(1).max(80),
  floor: z.string().max(20).optional(),
  capacity: z.number().int().min(1).max(50).optional(),
  status: roomStatus.optional(),
  notes: z.string().max(1000).optional(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const updateRoomSchema = createRoomSchema.partial();

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
