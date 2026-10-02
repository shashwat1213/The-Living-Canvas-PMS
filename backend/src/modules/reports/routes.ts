import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { monthlyAnalyticsQuerySchema, reportQuerySchema } from './schemas.js';
import { getMonthlyAnalytics, getRevenueReport } from './service.js';

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

/**
 * Monthly performance analytics — the dashboard's revenue-trend charts. Same
 * `reports:read` management gate and property scoping as the revenue report.
 */
reportsRouter.get(
  '/monthly',
  requirePermission('reports:read'),
  asyncHandler(async (req, res) => {
    const query = monthlyAnalyticsQuerySchema.parse(req.query);
    const analytics = await getMonthlyAnalytics(req.params.propertyId as string, query);
    res.json(analytics);
  }),
);
