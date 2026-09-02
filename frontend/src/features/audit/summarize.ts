import type { AuditEntry } from './types';

/**
 * Turns an entry's `metadata` into something a person can read.
 *
 * `metadata` is JSON of a shape that varies per action, and the API types
 * it as `unknown` because it genuinely is. Every read here goes through a
 * guard rather than a cast: an entry written by a future action this
 * build has never heard of must still render as a row, not crash the
 * page. That matters more here than elsewhere — the audit trail is the
 * screen someone opens *because* something unexpected happened.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function count(value: unknown): number | null {
  if (typeof value === 'number') return value;
  return Array.isArray(value) ? value.length : null;
}

/** Renders a diff value the way it should read, including "empty". */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length === 0 ? '—' : `${value.length}`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * The `{ field: { from, to } }` diff that property and room updates
 * carry. Returns an empty list for actions that don't record one.
 */
export function changedFields(entry: AuditEntry): FieldChange[] {
  const metadata = asRecord(entry.metadata);
  const changed = asRecord(metadata?.changed);
  if (!changed) return [];

  return Object.entries(changed).flatMap(([field, value]) => {
    const diff = asRecord(value);
    return diff && 'from' in diff && 'to' in diff ? [{ field, from: diff.from, to: diff.to }] : [];
  });
}

/** Turns `addressLine1` into `Address line 1` for display. */
export function humanizeField(field: string): string {
  const spaced = field.replace(/([A-Z])/g, ' $1').replace(/([0-9]+)/g, ' $1');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).trim().toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/**
 * A one-line description of what happened. Falls back to the raw action
 * name for anything unrecognized, so a newer backend never renders a
 * blank row.
 */
export function summarize(entry: AuditEntry): string {
  const m = asRecord(entry.metadata);

  switch (entry.action) {
    case 'staff.created': {
      const email = str(m?.email);
      const role = str(m?.role);
      return email ? `Added ${email}${role ? ` as ${role.toLowerCase()}` : ''}` : 'Added a staff member';
    }

    case 'staff.updated': {
      const from = asRecord(m?.from);
      const to = asRecord(m?.to);
      const before = [str(from?.firstName), str(from?.lastName)].filter(Boolean).join(' ');
      const after = [str(to?.firstName), str(to?.lastName)].filter(Boolean).join(' ');
      return before && after ? `Renamed ${before} to ${after}` : 'Updated staff details';
    }

    case 'staff.role_changed': {
      const from = str(m?.from);
      const to = str(m?.to);
      return from && to ? `Role changed from ${from.toLowerCase()} to ${to.toLowerCase()}` : 'Role changed';
    }

    case 'staff.deactivated':
      return str(m?.email) ? `Deactivated ${str(m?.email)}` : 'Deactivated a staff member';

    case 'staff.reactivated':
      return str(m?.email) ? `Reactivated ${str(m?.email)}` : 'Reactivated a staff member';

    case 'staff.property_access_changed': {
      const added = count(m?.added) ?? 0;
      const removed = count(m?.removed) ?? 0;
      const parts = [];
      if (added > 0) parts.push(`granted ${added} ${added === 1 ? 'property' : 'properties'}`);
      if (removed > 0) parts.push(`revoked ${removed}`);
      if (parts.length === 0) return 'Property access updated';
      return `Access ${parts.join(', ')}`;
    }

    case 'property.created': {
      const name = str(m?.name);
      const slug = str(m?.slug);
      return name ? `Created ${name}${slug ? ` (/${slug})` : ''}` : 'Created a property';
    }

    case 'property.updated':
    case 'room.updated': {
      const fields = changedFields(entry);
      const name = str(m?.name);
      const subject = name ? `${name}: ` : '';
      if (fields.length === 0) return `${subject}updated`;
      const list = fields.map((f) => humanizeField(f.field).toLowerCase()).join(', ');
      return `${subject}changed ${list}`;
    }

    case 'property.deleted': {
      const name = str(m?.name) ?? 'a property';
      const rooms = count(m?.cascadedRooms);
      // The cascade is the part someone reviewing this needs to see.
      return rooms && rooms > 0
        ? `Deleted ${name}, removing ${rooms} ${rooms === 1 ? 'room' : 'rooms'}`
        : `Deleted ${name}`;
    }

    case 'room.created': {
      const name = str(m?.name);
      const type = str(m?.roomType);
      return name ? `Added room ${name}${type ? ` (${type})` : ''}` : 'Added a room';
    }

    case 'room.deleted': {
      const name = str(m?.name);
      return name ? `Deleted room ${name}` : 'Deleted a room';
    }

    default:
      // An action this build doesn't know — show it rather than hide it.
      return entry.action;
  }
}
