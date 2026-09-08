import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { dashboardQuerySchema } from './schemas.js';
import { getDashboard } from './service.js';

/**
 * A property's operational dashboard — the front desk's daily cockpit.
 *
 * Mounted at /properties/:propertyId/dashboard, so `requirePropertyAccess`
 * runs before the handler exactly as every other property sub-route does.
 * Read-only and computed from reservations, rooms, housekeeping, maintenance
 * and folios, so it carries its own `dashboard:read` permission rather than
 * overloading one module's — a role that can read the cockpit shouldn't need
 * every underlying module's read grant, and vice versa.
 */
export const dashboardRouter = Router({ mergeParams: true });

dashboardRouter.use(authenticate, requirePropertyAccess());

dashboardRouter.get(
  '/',
  requirePermission('dashboard:read'),
  asyncHandler(async (req, res) => {
    const query = dashboardQuerySchema.parse(req.query);
    const dashboard = await getDashboard(req.params.propertyId as string, query.date);
    res.json(dashboard);
  }),
);
