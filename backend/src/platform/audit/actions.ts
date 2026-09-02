/**
 * The catalog of auditable actions and the entity types they act on.
 *
 * `action` is stored as a **string**, not a database enum, specifically so
 * that adding one is a constant here rather than a migration against a
 * table that only ever grows. The tradeoff — the database won't reject an
 * unknown action — is bought back by `AuditAction` below: nothing outside
 * this file can name an action that isn't listed, because `recordAuditEvent`
 * only accepts this union.
 *
 * Naming convention: `<module>.<past-tense event>`. The module prefix is
 * what keeps the namespace usable once properties, leases, maintenance and
 * agent actions share this table — `staff.created` and `lease.created` stay
 * distinguishable, and filtering a whole module is a prefix match.
 */
export const AUDIT_ACTIONS = {
  STAFF_CREATED: 'staff.created',
  STAFF_UPDATED: 'staff.updated',
  STAFF_ROLE_CHANGED: 'staff.role_changed',
  STAFF_DEACTIVATED: 'staff.deactivated',
  STAFF_REACTIVATED: 'staff.reactivated',
  STAFF_PROPERTY_ACCESS_CHANGED: 'staff.property_access_changed',

  PROPERTY_CREATED: 'property.created',
  PROPERTY_UPDATED: 'property.updated',
  PROPERTY_DELETED: 'property.deleted',

  // Rooms are audited alongside properties rather than left as a gap:
  // deleting a room destroys operational history, and "who took 204 out
  // of service" is the same question as "who deleted the property".
  ROOM_CREATED: 'room.created',
  ROOM_UPDATED: 'room.updated',
  ROOM_DELETED: 'room.deleted',

  // The room-type catalogue is what rate plans, availability and
  // reservations will all reference, so a rename or a retirement is a
  // consequential act even though the row itself is small.
  ROOM_TYPE_CREATED: 'room_type.created',
  ROOM_TYPE_UPDATED: 'room_type.updated',
  ROOM_TYPE_DELETED: 'room_type.deleted',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_ACTION_VALUES: AuditAction[] = Object.values(AUDIT_ACTIONS);

/**
 * The kinds of record an audit entry can point at. Grows alongside the
 * modules; `entityId` is whatever that module's primary key is.
 */
export const AUDIT_ENTITY_TYPES = {
  STAFF: 'staff',
  PROPERTY: 'property',
  ROOM: 'room',
  ROOM_TYPE: 'room_type',
} as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES];

export const AUDIT_ENTITY_TYPE_VALUES: AuditEntityType[] = Object.values(AUDIT_ENTITY_TYPES);
