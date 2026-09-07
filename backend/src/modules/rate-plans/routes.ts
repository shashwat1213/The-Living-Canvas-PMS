import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import {
  createRatePlanSchema,
  listRatePlansQuerySchema,
  listRatesQuerySchema,
  setRatesSchema,
  updateRatePlanSchema,
} from './schemas.js';
import * as ratePlansService from './service.js';

/**
 * The rate plans of one room type, and their per-date prices.
 *
 * Mounted at /properties/:propertyId/room-types/:roomTypeId/rate-plans — a
 * rate plan belongs to exactly one sellable type, and everything under here
 * is property-scoped, so `requirePropertyAccess` runs before every handler,
 * exactly as it does for rooms and room types.
 *
 * `rate-plans:read` (STAFF and up) to see the plans and their rates;
 * `rate-plans:manage` (MANAGER and up) to create, edit, retire, delete or
 * reprice them — repricing the hotel is not front-desk work.
 */
export const ratePlansRouter = Router({ mergeParams: true });

ratePlansRouter.use(authenticate, requirePropertyAccess());

ratePlansRouter.get(
  '/',
  requirePermission('rate-plans:read'),
  asyncHandler(async (req, res) => {
    const query = listRatePlansQuerySchema.parse(req.query);
    const { items, page } = await ratePlansService.listRatePlans(
      req.params.propertyId as string,
      req.params.roomTypeId as string,
      query,
    );
    res.json({ ratePlans: items, page });
  }),
);

ratePlansRouter.get(
  '/:ratePlanId',
  requirePermission('rate-plans:read'),
  asyncHandler(async (req, res) => {
    const ratePlan = await ratePlansService.getRatePlan(
      req.params.propertyId as string,
      req.params.roomTypeId as string,
      req.params.ratePlanId as string,
    );
    res.json({ ratePlan });
  }),
);

ratePlansRouter.post(
  '/',
  requirePermission('rate-plans:manage'),
  asyncHandler(async (req, res) => {
    const input = createRatePlanSchema.parse(req.body);
    const ratePlan = await ratePlansService.createRatePlan(
      req.params.propertyId as string,
      req.params.roomTypeId as string,
      input,
    );
    res.status(201).json({ ratePlan });
  }),
);

ratePlansRouter.patch(
  '/:ratePlanId',
  requirePermission('rate-plans:manage'),
  asyncHandler(async (req, res) => {
    const input = updateRatePlanSchema.parse(req.body);
    const ratePlan = await ratePlansService.updateRatePlan(
      req.params.propertyId as string,
      req.params.roomTypeId as string,
      req.params.ratePlanId as string,
      input,
    );
    res.json({ ratePlan });
  }),
);

ratePlansRouter.delete(
  '/:ratePlanId',
  requirePermission('rate-plans:manage'),
  asyncHandler(async (req, res) => {
    await ratePlansService.deleteRatePlan(
      req.params.propertyId as string,
      req.params.roomTypeId as string,
      req.params.ratePlanId as string,
    );
    res.status(204).send();
  }),
);

ratePlansRouter.get(
  '/:ratePlanId/rates',
  requirePermission('rate-plans:read'),
  asyncHandler(async (req, res) => {
    const query = listRatesQuerySchema.parse(req.query);
    const result = await ratePlansService.listRates(
      req.params.propertyId as string,
      req.params.roomTypeId as string,
      req.params.ratePlanId as string,
      query,
    );
    res.json(result);
  }),
);

ratePlansRouter.put(
  '/:ratePlanId/rates',
  requirePermission('rate-plans:manage'),
  asyncHandler(async (req, res) => {
    const input = setRatesSchema.parse(req.body);
    const result = await ratePlansService.setRates(
      req.params.propertyId as string,
      req.params.roomTypeId as string,
      req.params.ratePlanId as string,
      input,
    );
    res.json(result);
  }),
);
