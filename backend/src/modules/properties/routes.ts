import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { createPropertySchema, updatePropertySchema } from './schemas.js';
import * as propertiesService from './service.js';

export const propertiesRouter = Router();

propertiesRouter.use(authenticate);

propertiesRouter.get(
  '/properties',
  requirePermission('properties:read'),
  asyncHandler(async (_req, res) => {
    const properties = await propertiesService.listProperties();
    res.json({ properties });
  }),
);

propertiesRouter.post(
  '/properties',
  requirePermission('properties:create'),
  asyncHandler(async (req, res) => {
    const input = createPropertySchema.parse(req.body);
    const property = await propertiesService.createProperty(input);
    res.status(201).json({ property });
  }),
);

propertiesRouter.get(
  '/properties/:propertyId',
  requirePermission('properties:read'),
  requirePropertyAccess(),
  asyncHandler(async (req, res) => {
    const property = await propertiesService.getProperty(req.params.propertyId as string);
    res.json({ property });
  }),
);

propertiesRouter.patch(
  '/properties/:propertyId',
  requirePermission('properties:update'),
  requirePropertyAccess(),
  asyncHandler(async (req, res) => {
    const input = updatePropertySchema.parse(req.body);
    const property = await propertiesService.updateProperty(req.params.propertyId as string, input);
    res.json({ property });
  }),
);

propertiesRouter.delete(
  '/properties/:propertyId',
  requirePermission('properties:delete'),
  requirePropertyAccess(),
  asyncHandler(async (req, res) => {
    await propertiesService.deleteProperty(req.params.propertyId as string);
    res.status(204).end();
  }),
);
