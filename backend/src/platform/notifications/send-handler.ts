import type { Prisma } from '@prisma/client';

import { scopedPrisma } from '../tenancy/scoped-prisma.js';
import { registerJobHandler } from '../jobs/registry.js';
import { getChannelDriver } from './drivers.js';
import { NOTIFICATION_SEND_JOB } from './queue-notification.js';

/**
 * Handles a `notification.send` job: load the notification, hand it to the
 * channel's driver, and record the outcome. Runs inside the job's
 * organization context (the worker sets it), so `scopedPrisma` finds only
 * this tenant's row — a job payload naming another org's notification id
 * resolves to nothing and is treated as a spent job, never a cross-tenant
 * read.
 *
 * A driver reporting failure (or a delivery that throws) is surfaced as a
 * thrown error so the job worker's own retry/backoff takes over; the
 * attempt count and last error are also written onto the notification row
 * so the delivery state is legible in the log without cross-referencing the
 * jobs table.
 *
 * Idempotent: a notification already SENT is left untouched (a job may run
 * more than once if a process dies after delivery but before the row was
 * marked COMPLETED), so re-running never double-sends.
 */
export async function handleNotificationSend(payload: Prisma.JsonValue): Promise<void> {
  const notificationId =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).notificationId
      : undefined;
  if (typeof notificationId !== 'string') {
    throw new Error('notification.send job payload is missing a string notificationId.');
  }

  const notification = await scopedPrisma.notification.findFirst({ where: { id: notificationId } });
  if (!notification) {
    // The row is gone or belongs to another tenant — nothing to deliver.
    // Not an error: let the job complete rather than retry forever.
    return;
  }
  if (notification.status === 'SENT') {
    return;
  }

  const driver = getChannelDriver(notification.channel);
  const result = await driver.send(notification);

  if (result.ok) {
    await scopedPrisma.notification.update({
      where: { id: notification.id },
      data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
    return;
  }

  const message = result.error ?? 'Channel driver reported delivery failure.';
  await scopedPrisma.notification.update({
    where: { id: notification.id },
    data: { status: 'FAILED', attempts: { increment: 1 }, lastError: message },
  });
  // Throw so the job itself is retried/backed off by the worker; the next
  // successful attempt flips the row back to SENT.
  throw new Error(message);
}

let registered = false;

/**
 * Registers the notification job handler. Called once at startup (see
 * `app.ts` / worker bootstrap) and guarded so repeated calls — or a test
 * importing this module more than once — don't trip the registry's
 * duplicate-registration error.
 */
export function registerNotificationHandlers(): void {
  if (registered) return;
  registerJobHandler(NOTIFICATION_SEND_JOB, handleNotificationSend);
  registered = true;
}
