import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { listAuditLogsQuerySchema } from './schemas.js';
import * as auditService from './service.js';

/**
 * The organization's audit trail.
 *
 * Read-only: there is deliberately no write endpoint. Entries are
 * produced as a side effect of the actions they describe, inside the
 * services that perform them — an API that let a client post its own
 * audit entries would let it fabricate history, and one that let a client
 * delete them would let it erase history.
 *
 * `audit:read` is held by OWNER and ADMIN only. The trail records
 * administrative actions taken on people, so it is not appropriate
 * reading for the roles those actions are taken on.
 */
export const auditRouter = Router();

auditRouter.use(authenticate);

auditRouter.get(
  '/audit-logs',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const query = listAuditLogsQuerySchema.parse(req.query);
    const { items, page } = await auditService.listAuditLogs(query);
    res.json({ auditLogs: items, page });
  }),
);
