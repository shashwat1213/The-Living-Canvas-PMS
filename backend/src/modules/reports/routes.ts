import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { reportQuerySchema } from './schemas.js';
import { getRevenueReport } from './service.js';

/**
 * A property's management reports.
 *
 * Mounted at /properties/:propertyId/reports, so `requirePropertyAccess` runs
 * before the handler exactly as every other property sub-route does. Read-only
 * revenue/occupancy analytics behind `reports:read` — management work, held by
 * OWNER/ADMIN/MANAGER, not the front desk.
 */
export const reportsRouter = Router({ mergeParams: true });

reportsRouter.use(authenticate, requirePropertyAccess());

reportsRouter.get(
  '/revenue',
  requirePermission('reports:read'),
  asyncHandler(async (req, res) => {
    const query = reportQuerySchema.parse(req.query);
    const report = await getRevenueReport(req.params.propertyId as string, query);
    res.json(report);
  }),
);
