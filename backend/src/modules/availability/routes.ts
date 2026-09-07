import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { availabilityQuerySchema } from './schemas.js';
import * as availabilityService from './service.js';

/**
 * A property's availability grid.
 *
 * Mounted at /properties/:propertyId/availability — availability is a property
 * concern, so `requirePropertyAccess` runs before the handler. This is a
 * read-only view of the same inventory reservations occupy, so it reuses the
 * existing `reservations:read` permission rather than adding its own.
 */
export const availabilityRouter = Router({ mergeParams: true });

availabilityRouter.use(authenticate, requirePropertyAccess());

availabilityRouter.get(
  '/',
  requirePermission('reservations:read'),
  asyncHandler(async (req, res) => {
    const query = availabilityQuerySchema.parse(req.query);
    const availability = await availabilityService.getAvailability(req.params.propertyId as string, query);
    res.json(availability);
  }),
);
