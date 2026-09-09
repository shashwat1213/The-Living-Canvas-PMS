import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { listNotificationsQuerySchema } from './schemas.js';
import * as notificationsService from './service.js';

/**
 * The organization's notification log: what the PMS has sent (or queued /
 * failed to send) to guests and staff, and its delivery state.
 *
 * Read-only by design — notifications are composed by the system in
 * response to domain events (a booking confirmed, a reminder due), not
 * hand-authored, so there is no create/update/delete endpoint. Every route
 * is authenticated and guarded on `notifications:read`; the tenant filter
 * is applied by the scoped client, so a cross-organization query returns an
 * empty page and a zero total, never another tenant's messages.
 */
export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/notifications',
  requirePermission('notifications:read'),
  asyncHandler(async (req, res) => {
    const query = listNotificationsQuerySchema.parse(req.query);
    const { items, page } = await notificationsService.listNotifications(query);
    res.json({ notifications: items, page });
  }),
);
