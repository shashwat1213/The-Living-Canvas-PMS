import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { addChargeSchema, addPaymentSchema, createPaymentIntentSchema, verifyPaymentIntentSchema } from './schemas.js';
import * as foliosService from './service.js';
import * as paymentIntentsService from './payment-intents.service.js';

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

/**
 * Online payments through the gateway seam (`platform/payments`). Opening an
 * intent and verifying a return both post money, so both are `payments:manage`;
 * listing the intent history is `payments:read`.
 */
foliosRouter.get(
  '/payment-intents',
  requirePermission('payments:read'),
  asyncHandler(async (req, res) => {
    const folio = await foliosService.getOrOpenFolio(req.params.reservationId as string);
    const intents = await paymentIntentsService.listPaymentIntents(folio.id);
    res.json({ intents });
  }),
);

foliosRouter.post(
  '/payment-intents',
  requirePermission('payments:manage'),
  asyncHandler(async (req, res) => {
    const input = createPaymentIntentSchema.parse(req.body);
    const folio = await foliosService.getOrOpenFolio(req.params.reservationId as string);
    const intent = await paymentIntentsService.createPaymentIntent(folio.id, input);
    res.status(201).json({ intent });
  }),
);

foliosRouter.post(
  '/payment-intents/:intentId/verify',
  requirePermission('payments:manage'),
  asyncHandler(async (req, res) => {
    const input = verifyPaymentIntentSchema.parse(req.body);
    const intent = await paymentIntentsService.verifyPaymentIntent(req.params.intentId as string, input);
    res.json({ intent });
  }),
);

/**
 * DEV/DEMO: complete an intent as if the gateway checkout succeeded. Allowed
 * only while the stub provider is active (409 with live Razorpay). Runs the
 * exact same verification path with a stub-signed return — the demo path with
 * no external checkout to bounce through.
 */
foliosRouter.post(
  '/payment-intents/:intentId/simulate',
  requirePermission('payments:manage'),
  asyncHandler(async (req, res) => {
    const intent = await paymentIntentsService.simulatePaymentIntent(req.params.intentId as string);
    res.json({ intent });
  }),
);
