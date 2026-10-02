import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { chatRequestSchema } from './schemas.js';
import { answer } from './service.js';

/**
 * The in-app AI assistant for a property — a read-only chat grounded in the
 * property's live operational data.
 *
 * Mounted at /properties/:propertyId/assistant, so `requirePropertyAccess`
 * runs before the handler exactly as every other property sub-route does. It
 * is guarded by `dashboard:read`: the assistant answers from the same
 * operational snapshot the dashboard exposes (arrivals, occupancy,
 * housekeeping, maintenance, unsettled folios), so anyone who may read that
 * cockpit may ask the assistant about it, and no one else. Read-only — it
 * writes nothing and takes no audit entry.
 */
export const assistantRouter = Router({ mergeParams: true });

assistantRouter.use(authenticate, requirePropertyAccess());

assistantRouter.post(
  '/chat',
  requirePermission('dashboard:read'),
  asyncHandler(async (req, res) => {
    const input = chatRequestSchema.parse(req.body);
    const result = await answer(req.params.propertyId as string, input);
    res.json(result);
  }),
);
