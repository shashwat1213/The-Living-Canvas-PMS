import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type { AuditEntry, AuditListParams } from './types';

/**
 * The only place the audit endpoint is named.
 *
 * Read-only by design and by contract: the API exposes no POST, PATCH or
 * DELETE for audit entries, so neither does this module. Entries are
 * produced as a side effect of the actions they describe.
 */

const BASE = '/api/v1/audit-logs';

export interface AuditListResult {
  auditLogs: AuditEntry[];
  page: PageMeta;
}

export function listAuditLogs(params: AuditListParams = {}): Promise<AuditListResult> {
  return apiFetch<AuditListResult>(`${BASE}${toQueryString({ ...params })}`);
}
