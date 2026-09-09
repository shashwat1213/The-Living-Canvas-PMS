import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type { Notification, NotificationListParams } from './types';

/**
 * The only place the notifications endpoint is named.
 *
 * Read-only by design and by contract: the API exposes no POST, PATCH or
 * DELETE for notifications — they are produced as a side effect of the
 * domain events that trigger them — so neither does this module.
 */

const BASE = '/api/v1/notifications';

export interface NotificationListResult {
  notifications: Notification[];
  page: PageMeta;
}

export function listNotifications(params: NotificationListParams = {}): Promise<NotificationListResult> {
  return apiFetch<NotificationListResult>(`${BASE}${toQueryString({ ...params })}`);
}
