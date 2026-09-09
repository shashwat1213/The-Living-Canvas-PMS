import type { Prisma } from '@prisma/client';

import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { ListNotificationsQuery } from './schemas.js';

/**
 * The columns a notification is served with. `body` is included so the log
 * can show what was actually sent; no credential or internal id beyond the
 * notification's own fields is exposed.
 */
const notificationSelect = {
  id: true,
  channel: true,
  status: true,
  type: true,
  recipient: true,
  subject: true,
  body: true,
  entityType: true,
  entityId: true,
  attempts: true,
  lastError: true,
  sentAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;

/** No `organizationId` appears here — the scoping extension ANDs it in. */
function buildWhere(query: ListNotificationsQuery): Prisma.NotificationWhereInput {
  const where: Prisma.NotificationWhereInput = {};
  if (query.channel) where.channel = query.channel;
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.entityType) where.entityType = query.entityType;
  if (query.entityId) where.entityId = query.entityId;
  if (query.search) {
    // Every whitespace-separated term must match somewhere (recipient,
    // subject or type) — the same AND-of-terms search the staff list uses,
    // so "confirmation ravi" narrows rather than widens.
    const terms = query.search.split(/\s+/).filter(Boolean);
    where.AND = terms.map((term) => ({
      OR: [
        { recipient: { contains: term, mode: 'insensitive' } },
        { subject: { contains: term, mode: 'insensitive' } },
        { type: { contains: term, mode: 'insensitive' } },
      ],
    }));
  }
  return where;
}

export const notificationsRepository = {
  /**
   * One page of notifications, newest first — the log is read from the most
   * recent message backwards. `id` breaks ties on `createdAt` so messages
   * composed inside the same transaction keep a stable order across pages.
   * Count and page are read in one transaction so the total matches the rows.
   */
  async list(query: ListNotificationsQuery): Promise<{ items: NotificationRow[]; page: PageMeta }> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake(query);

    const [totalItems, rows] = await scopedPrisma.$transaction([
      scopedPrisma.notification.count({ where }),
      scopedPrisma.notification.findMany({
        where,
        select: notificationSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);

    return { items: rows, page: buildPageMeta(query, totalItems) };
  },
};
