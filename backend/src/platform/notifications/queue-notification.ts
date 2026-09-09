import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { enqueueJob } from '../jobs/queue.js';
import { getRequestContext } from '../tenancy/context.js';

/** The job type the notifications worker handles. */
export const NOTIFICATION_SEND_JOB = 'notification.send';

export interface QueueNotificationInput {
  channel: Prisma.NotificationCreateInput['channel'];
  /** Purpose, a namespaced string, e.g. "reservation.confirmation". */
  type: string;
  recipient: string;
  subject?: string;
  body: string;
  /** Optional polymorphic link back to the triggering entity. */
  entityType?: string;
  entityId?: string;
}

/** The minimal client surface `queueNotification` needs — satisfied by the
 * base client, the scoped client and any transaction from either, so a
 * notification can be composed inside the transaction that triggered it. */
export interface QueueNotificationDb {
  notification: {
    create(args: { data: Prisma.NotificationUncheckedCreateInput }): PromiseLike<{ id: string }>;
  };
  job: {
    create(args: { data: Prisma.JobUncheckedCreateInput }): PromiseLike<{ id: string }>;
  };
}

/**
 * Composes a notification, persists it as PENDING, and enqueues the job
 * that will deliver it — all against the passed client, so when called with
 * a transaction the message and its job commit atomically with the domain
 * change that triggered them. A booking that rolls back leaves no orphan
 * "your booking is confirmed" message, and a committed booking is
 * guaranteed to have its delivery job queued.
 *
 * Content is rendered by the caller and stored now, not at send time, so
 * the guest receives exactly what was composed at the triggering event
 * (see the Notification model doc). The organization is taken from the
 * request context, never a parameter — same tenant-safety rule as the audit
 * recorder and the job queue.
 */
export async function queueNotification(
  input: QueueNotificationInput,
  client: QueueNotificationDb = prisma,
): Promise<string> {
  const ctx = getRequestContext();

  const notification = await client.notification.create({
    data: {
      organizationId: ctx.organizationId,
      channel: input.channel,
      status: 'PENDING',
      type: input.type,
      recipient: input.recipient,
      subject: input.subject ?? null,
      body: input.body,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
  });

  await enqueueJob(
    { type: NOTIFICATION_SEND_JOB, payload: { notificationId: notification.id } },
    client,
  );

  return notification.id;
}
