import { z } from 'zod';

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
