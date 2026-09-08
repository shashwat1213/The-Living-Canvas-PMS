import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { addChargeSchema, addPaymentSchema } from './schemas.js';
import * as foliosService from './service.js';

/**
 * Folios (guest bills) for a property's reservations.
 *
 * Mounted at /properties/:propertyId/reservations/:reservationId/folio — a
 * folio belongs to a reservation, which belongs to a property, so everything
 * here is property-scoped and `requirePropertyAccess` runs before every
 * handler. `payments:read` to view the bill, `payments:manage` to post charges
 * and payments or open/close it. The scoped Prisma client enforces tenancy
 * through folio → reservation → property independently of these guards.
 */
export const foliosRouter = Router({ mergeParams: true });

foliosRouter.use(authenticate, requirePropertyAccess());

/** The bill for a reservation, opening one (with the room charge) on first view. */
foliosRouter.get(
  '/',
  requirePermission('payments:read'),
  asyncHandler(async (req, res) => {
    const folio = await foliosService.getOrOpenFolio(req.params.reservationId as string);
    res.json({ folio });
  }),
);

foliosRouter.post(
  '/charges',
  requirePermission('payments:manage'),
  asyncHandler(async (req, res) => {
    const input = addChargeSchema.parse(req.body);
    // Open (or find) the folio first so a charge can be posted the moment a
    // reservation exists, without a separate open step.
    const folio = await foliosService.getOrOpenFolio(req.params.reservationId as string);
    const updated = await foliosService.addCharge(folio.id, input);
    res.status(201).json({ folio: updated });
  }),
);

foliosRouter.post(
  '/payments',
  requirePermission('payments:manage'),
  asyncHandler(async (req, res) => {
    const input = addPaymentSchema.parse(req.body);
    const folio = await foliosService.getOrOpenFolio(req.params.reservationId as string);
    const updated = await foliosService.addPayment(folio.id, input);
    res.status(201).json({ folio: updated });
  }),
);

foliosRouter.post(
  '/close',
  requirePermission('payments:manage'),
  asyncHandler(async (req, res) => {
    const folio = await foliosService.getOrOpenFolio(req.params.reservationId as string);
    const updated = await foliosService.closeFolio(folio.id);
    res.json({ folio: updated });
  }),
);

foliosRouter.post(
  '/reopen',
  requirePermission('payments:manage'),
  asyncHandler(async (req, res) => {
    const folio = await foliosService.getOrOpenFolio(req.params.reservationId as string);
    const updated = await foliosService.reopenFolio(folio.id);
    res.json({ folio: updated });
  }),
);
