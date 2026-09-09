import type { Notification } from '@prisma/client';

/**
 * The result of a channel driver attempting to deliver one notification.
 * A driver that cannot deliver returns `ok: false` with an error rather
 * than throwing, so the send handler can record it on the notification row
 * and let the job's own retry/backoff decide what happens next.
 */
export interface DeliveryResult {
  ok: boolean;
  error?: string;
}

/**
 * A transport for one notification channel (email, SMS, WhatsApp, …).
 *
 * This is the seam the whole notifications system is built around: the
 * record, the queue, the retry logic and the UI are all channel-agnostic,
 * and a real provider (SMTP, Twilio, WhatsApp Business) is a drop-in
 * implementation of this interface behind the same `NotificationChannel`
 * value — no change to the enqueue path, the worker, or the log. Until
 * credentials are configured the `stored` driver stands in, which is what
 * lets the entire pipeline be exercised end-to-end without an external
 * account or any cost (see DECISIONS.md).
 */
export interface NotificationChannelDriver {
  /**
   * Attempt delivery. Implementations should be side-effect-honest: only
   * report `ok: true` when the message was actually handed to / accepted by
   * the provider, because the send handler marks the notification SENT on
   * that basis.
   */
  send(notification: Notification): Promise<DeliveryResult>;
}
