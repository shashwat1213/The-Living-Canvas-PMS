import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { createOrganizationSchema, updateOrganizationSchema } from './schemas.js';
import * as organizationsService from './service.js';

export const organizationsRouter = Router();

// Public — this is how a brand-new tenant is bootstrapped, so there is
// deliberately no authenticated caller yet at this one endpoint.
organizationsRouter.post(
  '/organizations',
  asyncHandler(async (req, res) => {
    const input = createOrganizationSchema.parse(req.body);
    const { organization } = await organizationsService.createOrganization(input);
    res.status(201).json({ organization });
  }),
);

organizationsRouter.get(
  '/organizations/me',
  authenticate,
  requirePermission('organizations:read'),
  asyncHandler(async (_req, res) => {
    const organization = await organizationsService.getOwnOrganization();
    res.json({ organization });
  }),
);

organizationsRouter.patch(
  '/organizations/me',
  authenticate,
  requirePermission('organizations:update'),
  asyncHandler(async (req, res) => {
    const input = updateOrganizationSchema.parse(req.body);
    const organization = await organizationsService.updateOwnOrganization(input);
    res.json({ organization });
  }),
);
