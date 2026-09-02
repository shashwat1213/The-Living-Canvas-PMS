import type { Prisma } from '@prisma/client';

import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { ListAuditLogsQuery } from './schemas.js';

/**
 * The columns an audit entry is served with. `actorUser` is joined so a
 * reader sees who acted without a second request; `actorEmail` is still
 * returned alongside it because that is the value captured at the time,
 * and it survives the account being removed.
 */
const auditSelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  actorType: true,
  actorUserId: true,
  actorEmail: true,
  metadata: true,
  createdAt: true,
  actorUser: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.AuditLogSelect;

type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof auditSelect }>;

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorUserId: string | null;
  /** Email captured when the action happened. */
  actorEmail: string | null;
  /** Current details of the acting account, or null if it no longer exists. */
  actor: { id: string; firstName: string; lastName: string; email: string } | null;
  metadata: unknown;
  createdAt: Date;
}

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    actor: row.actorUser,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}

/** No `organizationId` appears here — the scoping extension ANDs it in. */
function buildWhere(query: ListAuditLogsQuery): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (query.action) where.action = query.action;
  if (query.entityType) where.entityType = query.entityType;
  if (query.entityId) where.entityId = query.entityId;
  if (query.actorUserId) where.actorUserId = query.actorUserId;
  return where;
}

export const auditRepository = {
  /**
   * One page of audit entries, newest first — an audit trail is read
   * from the most recent event backwards, unlike the other list
   * endpoints, which are chronological.
   *
   * `id` breaks ties on `createdAt` so entries written inside the same
   * transaction (a rename and a role change in one request share a
   * timestamp to the millisecond) keep a stable order across pages.
   */
  async list(query: ListAuditLogsQuery): Promise<{ items: AuditEntry[]; page: PageMeta }> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake(query);

    const [totalItems, rows] = await scopedPrisma.$transaction([
      scopedPrisma.auditLog.count({ where }),
      scopedPrisma.auditLog.findMany({
        where,
        select: auditSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);

    return { items: rows.map(toAuditEntry), page: buildPageMeta(query, totalItems) };
  },
};
