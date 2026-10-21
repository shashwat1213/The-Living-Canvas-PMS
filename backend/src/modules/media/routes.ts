import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { createUploadSchema, listAssetsQuerySchema, updateAssetSchema } from './schemas.js';
import * as mediaService from './service.js';

/**
 * Marketing Studio media library (photos + videos) for a property.
 * Mounted at /properties/:propertyId/marketing/media. Reuses the marketing
 * permission tiers: `marketing:read` browses, `marketing:manage` uploads,
 * edits and deletes.
 */
export const mediaRouter = Router({ mergeParams: true });

mediaRouter.use(authenticate, requirePropertyAccess());

const pid = (req: { params: Record<string, string | undefined> }) => req.params.propertyId as string;
const aid = (req: { params: Record<string, string | undefined> }) => req.params.assetId as string;

mediaRouter.get(
  '/',
  requirePermission('marketing:read'),
  asyncHandler(async (req, res) => {
    const query = listAssetsQuerySchema.parse(req.query);
    const result = await mediaService.listAssets(pid(req), query);
    res.json({ media: result.items, page: result.page });
  }),
);

mediaRouter.get(
  '/albums',
  requirePermission('marketing:read'),
  asyncHandler(async (req, res) => {
    res.json({ albums: await mediaService.listAlbums(pid(req)) });
  }),
);

mediaRouter.post(
  '/uploads',
  requirePermission('marketing:manage'),
  asyncHandler(async (req, res) => {
    const input = createUploadSchema.parse(req.body);
    res.status(201).json(await mediaService.createUpload(pid(req), input));
  }),
);

mediaRouter.post(
  '/:assetId/complete',
  requirePermission('marketing:manage'),
  asyncHandler(async (req, res) => {
    res.json({ media: await mediaService.completeUpload(pid(req), aid(req)) });
  }),
);

mediaRouter.get(
  '/:assetId',
  requirePermission('marketing:read'),
  asyncHandler(async (req, res) => {
    res.json({ media: await mediaService.getAsset(pid(req), aid(req)) });
  }),
);

mediaRouter.get(
  '/:assetId/download',
  requirePermission('marketing:read'),
  asyncHandler(async (req, res) => {
    res.json({ url: await mediaService.getDownloadUrl(pid(req), aid(req)) });
  }),
);

mediaRouter.patch(
  '/:assetId',
  requirePermission('marketing:manage'),
  asyncHandler(async (req, res) => {
    const input = updateAssetSchema.parse(req.body);
    res.json({ media: await mediaService.updateAsset(pid(req), aid(req), input) });
  }),
);

mediaRouter.delete(
  '/:assetId',
  requirePermission('marketing:manage'),
  asyncHandler(async (req, res) => {
    await mediaService.deleteAsset(pid(req), aid(req));
    res.status(204).end();
  }),
);
