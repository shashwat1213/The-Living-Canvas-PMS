import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { createContentSchema, listContentQuerySchema, updateContentSchema } from './schemas.js';
import * as marketingService from './service.js';

/**
 * The AI Marketing Studio for a property: generate marketing copy, review
 * it, edit it, approve or discard it.
 *
 * Mounted at /properties/:propertyId/marketing, so `requirePropertyAccess`
 * runs before every handler. Three permission tiers:
 *  - `marketing:read` — see the content library;
 *  - `marketing:manage` — generate / edit / regenerate / discard;
 *  - `marketing:approve` — approve a draft for use.
 * All three sit at MANAGER and above (see the permission catalog): composing
 * and signing off the hotel's public voice is management work, not a
 * front-desk task.
 */
export const marketingRouter = Router({ mergeParams: true });

marketingRouter.use(authenticate, requirePropertyAccess());

marketingRouter.get(
  '/content',
  requirePermission('marketing:read'),
  asyncHandler(async (req, res) => {
    const query = listContentQuerySchema.parse(req.query);
    const result = await marketingService.listContent(req.params.propertyId as string, query);
    res.json({ content: result.items, page: result.page });
  }),
);

marketingRouter.get(
  '/content/:contentId',
  requirePermission('marketing:read'),
  asyncHandler(async (req, res) => {
    const content = await marketingService.getContent(
      req.params.propertyId as string,
      req.params.contentId as string,
    );
    res.json({ content });
  }),
);

marketingRouter.post(
  '/content',
  requirePermission('marketing:manage'),
  asyncHandler(async (req, res) => {
    const input = createContentSchema.parse(req.body);
    const content = await marketingService.createContent(req.params.propertyId as string, input);
    res.status(201).json({ content });
  }),
);

marketingRouter.patch(
  '/content/:contentId',
  requirePermission('marketing:manage'),
  asyncHandler(async (req, res) => {
    const input = updateContentSchema.parse(req.body);
    const content = await marketingService.updateContent(
      req.params.propertyId as string,
      req.params.contentId as string,
      input,
    );
    res.json({ content });
  }),
);

marketingRouter.post(
  '/content/:contentId/regenerate',
  requirePermission('marketing:manage'),
  asyncHandler(async (req, res) => {
    const content = await marketingService.regenerateContent(
      req.params.propertyId as string,
      req.params.contentId as string,
    );
    res.json({ content });
  }),
);

marketingRouter.post(
  '/content/:contentId/discard',
  requirePermission('marketing:manage'),
  asyncHandler(async (req, res) => {
    const content = await marketingService.discardContent(
      req.params.propertyId as string,
      req.params.contentId as string,
    );
    res.json({ content });
  }),
);

marketingRouter.post(
  '/content/:contentId/approve',
  requirePermission('marketing:approve'),
  asyncHandler(async (req, res) => {
    const content = await marketingService.approveContent(
      req.params.propertyId as string,
      req.params.contentId as string,
    );
    res.json({ content });
  }),
);
