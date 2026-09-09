/**
 * Domain types for the notification log, mirroring exactly what
 * `backend/src/modules/notifications` returns. Read-only: the API has no
 * write endpoint (notifications are composed by the system in response to
 * events), and neither does this feature.
 */

import type { BadgeTone } from '../../components/Badge';

/** Mirrors `NotificationChannel` in the Prisma schema. */
export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'STORED'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Mirrors `NotificationStatus` in the Prisma schema. */
export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  STORED: 'Stored',
};

export const STATUS_LABEL: Record<NotificationStatus, string> = {
  PENDING: 'Queued',
  SENT: 'Sent',
  FAILED: 'Failed',
};

/** Badge tone per delivery status — colour reinforces the label, never
 * replaces it. */
export const STATUS_TONE: Record<NotificationStatus, BadgeTone> = {
  PENDING: 'warning',
  SENT: 'positive',
  FAILED: 'danger',
};

/** One notification exactly as the API serves it. */
export interface Notification {
  id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
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

/** Server-side filters accepted by `GET /api/v1/notifications`. */
export interface NotificationListParams {
  search?: string;
  channel?: string;
  status?: string;
  type?: string;
  entityType?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}
