import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';
import { AUDIT_ACTION_VALUES, AUDIT_ENTITY_TYPE_VALUES } from '../../platform/audit/actions.js';

/**
 * Query parameters for `GET /audit-logs`: the shared pagination contract
 * plus the filters an audit trail is actually read with — "everything
 * about this person", "every role change", "everything this admin did".
 *
 * `action` and `entityType` validate against the catalog rather than
 * accepting free text, so a typo returns 400 instead of an empty page
 * that looks like "nothing happened".
 */
export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  action: z.enum(AUDIT_ACTION_VALUES as [string, ...string[]]).optional(),
  entityType: z.enum(AUDIT_ENTITY_TYPE_VALUES as [string, ...string[]]).optional(),
  entityId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
