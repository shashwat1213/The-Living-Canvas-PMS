import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { createGuestSchema, listGuestsQuerySchema, updateGuestSchema } from './schemas.js';
import * as guestsService from './service.js';

/**
 * Guest profiles, organization-scoped (a guest may stay at any of the
 * organization's properties, so there is no `:propertyId` in the path and no
 * `requirePropertyAccess`). `guests:read` to view, `guests:manage` to create,
 * edit and delete — both held by STAFF and up, because taking a booking is
 * front-desk work.
 */
export const guestsRouter = Router();

guestsRouter.use('/guests', authenticate);

guestsRouter.get(
  '/guests',
  requirePermission('guests:read'),
  asyncHandler(async (req, res) => {
    const query = listGuestsQuerySchema.parse(req.query);
    const { items, page } = await guestsService.listGuests(query);
    res.json({ guests: items, page });
  }),
);

guestsRouter.get(
  '/guests/:guestId',
  requirePermission('guests:read'),
  asyncHandler(async (req, res) => {
    const guest = await guestsService.getGuest(req.params.guestId as string);
    res.json({ guest });
  }),
);

guestsRouter.post(
  '/guests',
  requirePermission('guests:manage'),
  asyncHandler(async (req, res) => {
    const input = createGuestSchema.parse(req.body);
    const guest = await guestsService.createGuest(input);
    res.status(201).json({ guest });
  }),
);

guestsRouter.patch(
  '/guests/:guestId',
  requirePermission('guests:manage'),
  asyncHandler(async (req, res) => {
    const input = updateGuestSchema.parse(req.body);
    const guest = await guestsService.updateGuest(req.params.guestId as string, input);
    res.json({ guest });
  }),
);

guestsRouter.delete(
  '/guests/:guestId',
  requirePermission('guests:manage'),
  asyncHandler(async (req, res) => {
    await guestsService.deleteGuest(req.params.guestId as string);
    res.status(204).send();
  }),
);
