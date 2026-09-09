import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

/**
 * Query parameters for `GET /notifications`: the shared pagination contract
 * plus the filters the log is actually read with — "everything on this
 * channel", "everything still failing", "every message for this
 * reservation", or a free-text search across recipient/subject/type.
 *
 * `channel` and `status` validate against the enum rather than free text,
 * so a typo is a 400 instead of an empty page that reads as "nothing here".
 */
export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'STORED'] as const;
export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  type: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(120).optional(),
  entityId: z.string().uuid().optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
