import type { Notification, NotificationChannel } from '@prisma/client';

import type { NotificationChannelDriver } from './channel.js';

/**
 * The default driver: it delivers nothing externally, it just accepts the
 * message. The notification row is already the durable record of what was
 * composed, so a "stored" send is a successful no-op — the pipeline (queue,
 * worker, status transitions, log UI) runs exactly as it will with a real
 * provider, minus the outbound call and its cost/credentials.
 *
 * This is intentionally the fallback for every channel that has no real
 * driver registered yet, so EMAIL/SMS/WHATSAPP all work end-to-end in
 * development, tests and CI and light up for real the moment an adapter is
 * dropped into the registry.
 */
export const storedDriver: NotificationChannelDriver = {
  async send(_notification: Notification) {
    return { ok: true };
  },
};

/**
 * Channel → driver registry. A real adapter registers itself here (e.g.
 * `registerChannelDriver('EMAIL', smtpDriver)`); anything unregistered
 * falls back to `storedDriver`. Kept as a mutable map rather than a static
 * object so wiring a provider is one line at startup, not a code change to
 * this file.
 */
const drivers = new Map<NotificationChannel, NotificationChannelDriver>();

export function registerChannelDriver(
  channel: NotificationChannel,
  driver: NotificationChannelDriver,
): void {
  drivers.set(channel, driver);
}

export function getChannelDriver(channel: NotificationChannel): NotificationChannelDriver {
  return drivers.get(channel) ?? storedDriver;
}

/** Test-only: drop registered real drivers so a suite starts from the
 * stored-driver baseline. */
export function resetChannelDrivers(): void {
  drivers.clear();
}
