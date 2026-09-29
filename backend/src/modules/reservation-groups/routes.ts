import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { cancelReservationGroupSchema, createReservationGroupSchema } from './schemas.js';
import * as service from './service.js';

/**
 * A property's block / group bookings.
 *
 * Mounted at /properties/:propertyId/reservation-groups — a block belongs to a
 * property, so `requirePropertyAccess` runs before every handler. A block is a
 * booking operation, so it reuses the reservations permissions: `read` to view,
 * `manage` to create or cancel — no new permission tier.
 */
export const reservationGroupsRouter = Router({ mergeParams: true });

reservationGroupsRouter.use(authenticate, requirePropertyAccess());

reservationGroupsRouter.get(
  '/',
  requirePermission('reservations:read'),
  asyncHandler(async (req, res) => {
    const groups = await service.listReservationGroups(req.params.propertyId as string);
    res.json({ groups });
  }),
);

reservationGroupsRouter.get(
  '/:groupId',
  requirePermission('reservations:read'),
  asyncHandler(async (req, res) => {
    const group = await service.getReservationGroup(req.params.propertyId as string, req.params.groupId as string);
    res.json({ group });
  }),
);

reservationGroupsRouter.post(
  '/',
  requirePermission('reservations:manage'),
  asyncHandler(async (req, res) => {
    const input = createReservationGroupSchema.parse(req.body);
    const group = await service.createReservationGroup(req.params.propertyId as string, input);
    res.status(201).json({ group });
  }),
);

reservationGroupsRouter.post(
  '/:groupId/cancel',
  requirePermission('reservations:manage'),
  asyncHandler(async (req, res) => {
    const input = cancelReservationGroupSchema.parse(req.body ?? {});
    const group = await service.cancelReservationGroup(
      req.params.propertyId as string,
      req.params.groupId as string,
      input,
    );
    res.json({ group });
  }),
);
