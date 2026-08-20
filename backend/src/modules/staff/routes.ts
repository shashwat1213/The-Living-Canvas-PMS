import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { createStaffSchema, setPropertyAccessSchema, updateStaffSchema } from './schemas.js';
import * as staffService from './service.js';

/**
 * Staff administration. Every route is authenticated and permission-
 * guarded; the mutating ones additionally go through the role-rank rules
 * in `service.ts`, which the permission guard alone cannot express (it
 * knows what the caller may do, not who they may do it to).
 *
 * There is deliberately no DELETE. Offboarding is `PATCH { isActive:
 * false }`, which routes through `deactivateUser` — hard-deleting a staff
 * row would cascade their sessions and property grants away and destroy
 * the record of who did what, which is not the same operation and is not
 * one this API should offer casually.
 */
export const staffRouter = Router();

staffRouter.use(authenticate);

staffRouter.get(
  '/staff',
  requirePermission('staff:read'),
  asyncHandler(async (_req, res) => {
    const staff = await staffService.listStaff();
    res.json({ staff });
  }),
);

staffRouter.get(
  '/staff/:userId',
  requirePermission('staff:read'),
  asyncHandler(async (req, res) => {
    const member = await staffService.getStaff(req.params.userId as string);
    res.json({ staff: member });
  }),
);

staffRouter.post(
  '/staff',
  requirePermission('staff:manage'),
  asyncHandler(async (req, res) => {
    const input = createStaffSchema.parse(req.body);
    const member = await staffService.createStaff(input);
    res.status(201).json({ staff: member });
  }),
);

staffRouter.patch(
  '/staff/:userId',
  requirePermission('staff:manage'),
  asyncHandler(async (req, res) => {
    const input = updateStaffSchema.parse(req.body);
    const member = await staffService.updateStaff(req.params.userId as string, input);
    res.json({ staff: member });
  }),
);

staffRouter.put(
  '/staff/:userId/property-access',
  requirePermission('staff:manage'),
  asyncHandler(async (req, res) => {
    const { propertyIds } = setPropertyAccessSchema.parse(req.body);
    const member = await staffService.setPropertyAccess(req.params.userId as string, propertyIds);
    res.json({ staff: member });
  }),
);
