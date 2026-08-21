import type { Property } from '@prisma/client';

import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { withUniqueConstraintGuard } from '../../lib/prisma-errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { getRequestContext, isOrgWideCaller } from '../../platform/tenancy/context.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { propertiesRepository } from './repository.js';
import type { CreatePropertyInput, ListPropertiesQuery, UpdatePropertyInput } from './schemas.js';

/**
 * Filters the org's properties down to the caller's granted subset.
 * OWNER/ADMIN see every property in the org (tenant scoping already
 * limits this to their own org); MANAGER/STAFF see only what they hold a
 * PropertyAccess grant for. Single-property routes (get/update/delete)
 * don't need this — they sit behind the `requirePropertyAccess` route
 * guard instead (see routes.ts), which is the same check applied to one
 * ID rather than a list.
 *
 * The grant filter is handed to the repository as a query condition
 * rather than applied to the returned rows. That distinction became
 * load-bearing when this endpoint was paginated: filtering *after* the
 * database has already sliced a page produces short pages (page 1 of 25
 * returning 3 rows) and a `totalItems` counting properties the caller
 * can't see. Both are wrong in the direction that leaks information, so
 * the restriction has to be part of the query the count runs against.
 */
export async function listProperties(query: ListPropertiesQuery): Promise<{ items: Property[]; page: PageMeta }> {
  if (isOrgWideCaller()) {
    return propertiesRepository.list(query);
  }
  const ctx = getRequestContext();
  return propertiesRepository.list(query, { allowedIds: [...ctx.grantedPropertyIds] });
}

export async function getProperty(id: string): Promise<Property> {
  const property = await propertiesRepository.findById(id);
  if (!property) {
    throw new NotFoundError('Property not found.');
  }
  return property;
}

/**
 * Checks for an existing slug before writing, rather than relying solely
 * on catching the database's unique-constraint error — gives a clean
 * `ConflictError` on the common path instead of depending on the
 * database round-tripping a well-formed constraint-violation error for
 * every write. The `isUniqueConstraintError` catch below stays in place
 * as a backstop for the narrow race between the check and the write.
 */
export async function createProperty(input: CreatePropertyInput): Promise<Property> {
  const existing = await propertiesRepository.findBySlug(input.slug);
  if (existing) {
    throw new ConflictError('A property with that slug already exists.');
  }
  // The write and its audit entry share one transaction, so neither can
  // exist without the other. The transaction is opened on the *scoped*
  // client: the tenancy extension propagates into it, so the organization
  // filter is still injected on every statement inside.
  return withUniqueConstraintGuard(
    () =>
      scopedPrisma.$transaction(async (tx) => {
        const property = await propertiesRepository.create(input, tx);
        await recordAuditEvent(
          {
            action: AUDIT_ACTIONS.PROPERTY_CREATED,
            entityType: AUDIT_ENTITY_TYPES.PROPERTY,
            entityId: property.id,
            metadata: { name: property.name, slug: property.slug },
          },
          tx,
        );
        return property;
      }),
    'A property with that slug already exists.',
  );
}

export async function updateProperty(id: string, input: UpdatePropertyInput): Promise<Property> {
  if (input.slug) {
    const existing = await propertiesRepository.findBySlug(input.slug);
    if (existing && existing.id !== id) {
      throw new ConflictError('A property with that slug already exists.');
    }
  }

  // Read first so the audit entry can report what actually changed rather
  // than just the submitted payload. This also gives update the same 404
  // semantics as get for an ID outside the caller's organization.
  const before = await getProperty(id);

  return withUniqueConstraintGuard(
    () =>
      scopedPrisma.$transaction(async (tx) => {
        const property = await propertiesRepository.update(id, input, tx);

        const changed = diffProperty(before, property);
        if (Object.keys(changed).length > 0) {
          await recordAuditEvent(
            {
              action: AUDIT_ACTIONS.PROPERTY_UPDATED,
              entityType: AUDIT_ENTITY_TYPES.PROPERTY,
              entityId: property.id,
              metadata: { name: property.name, changed },
            },
            tx,
          );
        }
        return property;
      }),
    'A property with that slug already exists.',
  );
}

/**
 * A single field's movement. Typed to JSON scalars rather than `unknown`
 * so an unserializable value (a Date, a relation) can't be recorded by
 * accident — it fails at compile time instead.
 */
type FieldChange = { from: string | number | boolean | null; to: string | number | boolean | null };

/**
 * The fields that actually moved, as `{ field: { from, to } }`. Comparing
 * the persisted before/after rather than the request body means a
 * no-op write (submitting the value a field already had) doesn't produce
 * an audit entry claiming a change.
 */
function diffProperty(before: Property, after: Property): Record<string, FieldChange> {
  const tracked = [
    'name',
    'slug',
    'timezone',
    'addressLine1',
    'addressLine2',
    'city',
    'region',
    'postalCode',
    'country',
    'isActive',
  ] as const;

  const changed: Record<string, FieldChange> = {};
  for (const field of tracked) {
    if (before[field] !== after[field]) {
      changed[field] = { from: before[field], to: after[field] };
    }
  }
  return changed;
}

export async function deleteProperty(id: string): Promise<void> {
  // Captured before the delete — afterwards the row is gone, and an audit
  // entry that can only say "some property was deleted" is not much of a
  // record. Rooms cascade with it, so the count is worth keeping too.
  const property = await getProperty(id);
  const roomCount = await propertiesRepository.countRooms(id);

  await scopedPrisma.$transaction(async (tx) => {
    await propertiesRepository.remove(id, tx);
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.PROPERTY_DELETED,
        entityType: AUDIT_ENTITY_TYPES.PROPERTY,
        entityId: id,
        metadata: { name: property.name, slug: property.slug, cascadedRooms: roomCount },
      },
      tx,
    );
  });
}
