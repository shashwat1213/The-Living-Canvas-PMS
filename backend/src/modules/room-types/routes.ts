import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { createRoomTypeSchema, listRoomTypesQuerySchema, updateRoomTypeSchema } from './schemas.js';
import * as roomTypesService from './service.js';

/**
 * The room-type catalogue of one property.
 *
 * Mounted at /properties/:propertyId/room-types — every route here is
 * property-scoped, so `requirePropertyAccess` runs before every handler,
 * exactly as it does for rooms.
 *
 * Read and manage are separate permissions on purpose: STAFF can see the
 * catalogue (a room's type is front-desk information) but only MANAGER
 * and above configure it. Deletion is refused while rooms still use a
 * type — see `service.ts`.
 */
export const roomTypesRouter = Router({ mergeParams: true });

roomTypesRouter.use(authenticate, requirePropertyAccess());

roomTypesRouter.get(
  '/',
  requirePermission('room-types:read'),
  asyncHandler(async (req, res) => {
    const query = listRoomTypesQuerySchema.parse(req.query);
    const { items, page } = await roomTypesService.listRoomTypes(req.params.propertyId as string, query);
    res.json({ roomTypes: items, page });
  }),
);

roomTypesRouter.get(
  '/:roomTypeId',
  requirePermission('room-types:read'),
  asyncHandler(async (req, res) => {
    const roomType = await roomTypesService.getRoomType(
      req.params.propertyId as string,
      req.params.roomTypeId as string,
    );
    res.json({ roomType });
  }),
);

roomTypesRouter.post(
  '/',
  requirePermission('room-types:manage'),
  asyncHandler(async (req, res) => {
    const input = createRoomTypeSchema.parse(req.body);
    const roomType = await roomTypesService.createRoomType(req.params.propertyId as string, input);
    res.status(201).json({ roomType });
  }),
);

roomTypesRouter.patch(
  '/:roomTypeId',
  requirePermission('room-types:manage'),
  asyncHandler(async (req, res) => {
    const input = updateRoomTypeSchema.parse(req.body);
    const roomType = await roomTypesService.updateRoomType(
      req.params.propertyId as string,
      req.params.roomTypeId as string,
      input,
    );
    res.json({ roomType });
  }),
);

roomTypesRouter.delete(
  '/:roomTypeId',
  requirePermission('room-types:manage'),
  asyncHandler(async (req, res) => {
    await roomTypesService.deleteRoomType(req.params.propertyId as string, req.params.roomTypeId as string);
    res.status(204).send();
  }),
);
