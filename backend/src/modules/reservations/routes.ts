import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { cancelReservationSchema, createReservationSchema, listReservationsQuerySchema } from './schemas.js';
import * as reservationsService from './service.js';

/**
 * A property's reservations.
 *
 * Mounted at /properties/:propertyId/reservations — a booking belongs to a
 * property, so everything here is property-scoped and `requirePropertyAccess`
 * runs before every handler. `reservations:read` to view, `reservations:manage`
 * to book, cancel or mark a no-show — both held by STAFF and up, since taking
 * bookings is the front desk's core job.
 */
export const reservationsRouter = Router({ mergeParams: true });

reservationsRouter.use(authenticate, requirePropertyAccess());

reservationsRouter.get(
  '/',
  requirePermission('reservations:read'),
  asyncHandler(async (req, res) => {
    const query = listReservationsQuerySchema.parse(req.query);
    const { items, page } = await reservationsService.listReservations(req.params.propertyId as string, query);
    res.json({ reservations: items, page });
  }),
);

reservationsRouter.get(
  '/:reservationId',
  requirePermission('reservations:read'),
  asyncHandler(async (req, res) => {
    const reservation = await reservationsService.getReservation(
      req.params.propertyId as string,
      req.params.reservationId as string,
    );
    res.json({ reservation });
  }),
);

/**
 * A pre-booking quote: availability and price for a proposed stay, without
 * writing anything. Reuses the create schema — it validates the same inputs.
 * `read` permission is enough because it changes nothing.
 */
reservationsRouter.post(
  '/quote',
  requirePermission('reservations:read'),
  asyncHandler(async (req, res) => {
    const input = createReservationSchema.parse(req.body);
    const quote = await reservationsService.quoteReservation(req.params.propertyId as string, input);
    res.json(quote);
  }),
);

reservationsRouter.post(
  '/',
  requirePermission('reservations:manage'),
  asyncHandler(async (req, res) => {
    const input = createReservationSchema.parse(req.body);
    const reservation = await reservationsService.createReservation(req.params.propertyId as string, input);
    res.status(201).json({ reservation });
  }),
);

reservationsRouter.post(
  '/:reservationId/cancel',
  requirePermission('reservations:manage'),
  asyncHandler(async (req, res) => {
    const input = cancelReservationSchema.parse(req.body ?? {});
    const reservation = await reservationsService.cancelReservation(
      req.params.propertyId as string,
      req.params.reservationId as string,
      input,
    );
    res.json({ reservation });
  }),
);

reservationsRouter.post(
  '/:reservationId/no-show',
  requirePermission('reservations:manage'),
  asyncHandler(async (req, res) => {
    const reservation = await reservationsService.markNoShow(
      req.params.propertyId as string,
      req.params.reservationId as string,
    );
    res.json({ reservation });
  }),
);
