/**
 * Domain types for the audit trail, mirroring exactly what
 * `backend/src/modules/audit` returns. Read-only: the API has no write
 * endpoint, and neither does this feature.
 */

/** Mirrors `AUDIT_ACTIONS` in `backend/src/platform/audit/actions.ts`. */
export const AUDIT_ACTIONS = [
  'staff.created',
  'staff.updated',
  'staff.role_changed',
  'staff.deactivated',
  'staff.reactivated',
  'staff.property_access_changed',
  'property.created',
  'property.updated',
  'property.deleted',
  'room.created',
  'room.updated',
  'room.deleted',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = ['staff', 'property', 'room'] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const ENTITY_TYPE_LABEL: Record<AuditEntityType, string> = {
  staff: 'Staff',
  property: 'Property',
  room: 'Room',
};

/** Short verb for the action, shown as a badge. */
export const ACTION_LABEL: Record<AuditAction, string> = {
  'staff.created': 'Staff added',
  'staff.updated': 'Staff updated',
  'staff.role_changed': 'Role changed',
  'staff.deactivated': 'Deactivated',
  'staff.reactivated': 'Reactivated',
  'staff.property_access_changed': 'Access changed',
  'property.created': 'Property added',
  'property.updated': 'Property updated',
  'property.deleted': 'Property deleted',
  'room.created': 'Room added',
  'room.updated': 'Room updated',
  'room.deleted': 'Room deleted',
};

/**
 * Actions that removed something or took access away. Used only to tone
 * the badge — the label always carries the meaning on its own, so this
 * reads identically to someone who can't distinguish the tones.
 */
const DESTRUCTIVE_ACTIONS = new Set<string>([
  'staff.deactivated',
  'property.deleted',
  'room.deleted',
]);

export function isDestructiveAction(action: string): boolean {
  return DESTRUCTIVE_ACTIONS.has(action);
}

/**
 * One entry, exactly as the API serves it. `metadata` is deliberately
 * `unknown`: its shape varies per action and the server types it as JSON,
 * so every read of it goes through a guarded accessor rather than a cast
 * (see `summarize.ts`).
 */
export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorUserId: string | null;
  /** The actor's email captured when the action happened. */
  actorEmail: string | null;
  /** The acting account as it exists now, or null if it is gone. */
  actor: { id: string; firstName: string; lastName: string; email: string } | null;
  metadata: unknown;
  createdAt: string;
}

/** Server-side filters accepted by `GET /api/v1/audit-logs`. */
export interface AuditListParams {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Who acted, preferring the account as it exists now and falling back to
 * the email captured at the time — which is the whole reason that column
 * is denormalized on the row.
 */
export function actorLabel(entry: AuditEntry): string {
  if (entry.actor) {
    const name = `${entry.actor.firstName} ${entry.actor.lastName}`.trim();
    return name || entry.actor.email;
  }
  if (entry.actorEmail) return entry.actorEmail;
  return entry.actorType === 'USER' ? 'Deleted account' : entry.actorType;
}
