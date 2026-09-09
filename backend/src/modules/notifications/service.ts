import type { PageMeta } from '../../lib/pagination.js';
import { notificationsRepository, type NotificationRow } from './repository.js';
import type { ListNotificationsQuery } from './schemas.js';

/**
 * The wire shape of a notification. Dates are serialized to ISO strings;
 * everything else passes through. Read-only — notifications are composed by
 * the system in response to domain events (see `platform/notifications`),
 * never created or edited through this module.
 */
export interface NotificationView {
  id: string;
  channel: NotificationRow['channel'];
  status: NotificationRow['status'];
  type: string;
  recipient: string;
  subject: string | null;
  body: string;
  entityType: string | null;
  entityId: string | null;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

function serialize(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    type: row.type,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    attempts: row.attempts,
    lastError: row.lastError,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(
  query: ListNotificationsQuery,
): Promise<{ items: NotificationView[]; page: PageMeta }> {
  const { items, page } = await notificationsRepository.list(query);
  return { items: items.map(serialize), page };
}
