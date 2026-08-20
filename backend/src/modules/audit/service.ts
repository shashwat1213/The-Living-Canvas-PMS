import type { PageMeta } from '../../lib/pagination.js';
import { auditRepository, type AuditEntry } from './repository.js';
import type { ListAuditLogsQuery } from './schemas.js';

/**
 * Read-only by design. There is no create, update or delete here: audit
 * entries are written by `platform/audit/recorder.ts` from inside the
 * service performing the action, and nothing in the application can
 * amend or remove one afterwards. A trail that the people it records can
 * edit is not evidence of anything.
 */
export async function listAuditLogs(query: ListAuditLogsQuery): Promise<{ items: AuditEntry[]; page: PageMeta }> {
  return auditRepository.list(query);
}
