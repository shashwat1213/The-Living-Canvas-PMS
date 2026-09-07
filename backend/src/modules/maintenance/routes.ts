import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { createWorkOrderSchema, listWorkOrdersQuerySchema, updateWorkOrderSchema } from './schemas.js';
import * as maintenanceService from './service.js';

/**
 * Maintenance work orders for a property.
 *
 * Mounted at /properties/:propertyId/maintenance/work-orders — everything here
 * is property-scoped, so `requirePropertyAccess` runs before every handler.
 * `maintenance:read` to view, `maintenance:manage` to create/update and to
 * take rooms out of service. The scoped Prisma client enforces tenancy through
 * the property relation independently of these guards.
 */
export const maintenanceRouter = Router({ mergeParams: true });

maintenanceRouter.use(authenticate, requirePropertyAccess());

maintenanceRouter.get(
  '/',
  requirePermission('maintenance:read'),
  asyncHandler(async (req, res) => {
    const query = listWorkOrdersQuerySchema.parse(req.query);
    const { items, page } = await maintenanceService.listWorkOrders(req.params.propertyId as string, query);
    res.json({ workOrders: items, page });
  }),
);

maintenanceRouter.post(
  '/',
  requirePermission('maintenance:manage'),
  asyncHandler(async (req, res) => {
    const input = createWorkOrderSchema.parse(req.body);
    const workOrder = await maintenanceService.createWorkOrder(req.params.propertyId as string, input);
    res.status(201).json({ workOrder });
  }),
);

maintenanceRouter.get(
  '/:workOrderId',
  requirePermission('maintenance:read'),
  asyncHandler(async (req, res) => {
    const workOrder = await maintenanceService.getWorkOrder(req.params.propertyId as string, req.params.workOrderId as string);
    res.json({ workOrder });
  }),
);

maintenanceRouter.patch(
  '/:workOrderId',
  requirePermission('maintenance:manage'),
  asyncHandler(async (req, res) => {
    const input = updateWorkOrderSchema.parse(req.body);
    const workOrder = await maintenanceService.updateWorkOrder(
      req.params.propertyId as string,
      req.params.workOrderId as string,
      input,
    );
    res.json({ workOrder });
  }),
);
