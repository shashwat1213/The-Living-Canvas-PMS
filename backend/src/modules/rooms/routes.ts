import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { createRoomSchema, listRoomsQuerySchema, updateRoomSchema } from './schemas.js';
import * as roomsService from './service.js';

// Mounted at /properties/:propertyId/rooms — every route here is
// property-scoped, so `requirePropertyAccess` runs before every handler.
export const roomsRouter = Router({ mergeParams: true });

roomsRouter.use(authenticate, requirePropertyAccess());

roomsRouter.get(
  '/',
  requirePermission('rooms:read'),
  asyncHandler(async (req, res) => {
    const query = listRoomsQuerySchema.parse(req.query);
    const { items, page } = await roomsService.listRooms(req.params.propertyId as string, query);
    res.json({ rooms: items, page });
  }),
);

roomsRouter.post(
  '/',
  requirePermission('rooms:create'),
  asyncHandler(async (req, res) => {
    const input = createRoomSchema.parse(req.body);
    const room = await roomsService.createRoom(req.params.propertyId as string, input);
    res.status(201).json({ room });
  }),
);

roomsRouter.get(
  '/:roomId',
  requirePermission('rooms:read'),
  asyncHandler(async (req, res) => {
    const room = await roomsService.getRoom(req.params.propertyId as string, req.params.roomId as string);
    res.json({ room });
  }),
);

roomsRouter.patch(
  '/:roomId',
  requirePermission('rooms:update'),
  asyncHandler(async (req, res) => {
    const input = updateRoomSchema.parse(req.body);
    const room = await roomsService.updateRoom(req.params.propertyId as string, req.params.roomId as string, input);
    res.json({ room });
  }),
);

roomsRouter.delete(
  '/:roomId',
  requirePermission('rooms:delete'),
  asyncHandler(async (req, res) => {
    await roomsService.deleteRoom(req.params.propertyId as string, req.params.roomId as string);
    res.status(204).end();
  }),
);
