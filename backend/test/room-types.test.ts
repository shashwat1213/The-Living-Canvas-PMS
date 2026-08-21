/**
 * RoomType schema foundation (Phase 2 task 2a — see TASKS.md).
 *
 * There is no RoomType API yet, so these tests exercise the two things
 * the schema slice is actually responsible for: that the model is
 * tenant-scoped by the extension in `platform/tenancy/scoped-prisma.ts`,
 * and that the migration's backfill left `rooms` and `room_types`
 * mutually consistent. The HTTP-level cases belong with the API slice
 * that introduces the routes.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { runWithRequestContext } from '../src/platform/tenancy/context.js';
import { scopedPrisma } from '../src/platform/tenancy/scoped-prisma.js';
import { loginAsNewOwner } from './helpers.js';

/** A request context carrying nothing but the tenant, which is what the extension reads. */
function contextFor(organizationId: string) {
  return {
    userId: 'unused-for-these-queries',
    organizationId,
    permissions: new Set<string>(),
    roleNames: new Set<string>(),
    grantedPropertyIds: new Set<string>(),
  };
}

/** Creates a property plus one room type through the unscoped client, as a fixture. */
async function seedRoomType(organizationId: string, typeName: string) {
  const suffix = randomUUID().slice(0, 8);
  const property = await prisma.property.create({
    data: { organizationId, name: `Fixture ${suffix}`, slug: `fixture-${suffix}` },
  });
  const roomType = await prisma.roomType.create({
    data: { propertyId: property.id, name: typeName },
  });
  return { propertyId: property.id, roomTypeId: roomType.id };
}

describe('RoomType is tenant-scoped through its property', () => {
  it("never returns another organization's room types, and never counts them", async () => {
    const orgA = await loginAsNewOwner('RoomType Org A');
    const orgB = await loginAsNewOwner('RoomType Org B');

    const a = await seedRoomType(orgA.organizationId, `A Deluxe ${randomUUID().slice(0, 6)}`);
    const b = await seedRoomType(orgB.organizationId, `B Deluxe ${randomUUID().slice(0, 6)}`);

    // Awaited *inside* the context callback on purpose: a Prisma promise
    // is lazy, so returning it unawaited would execute the query after
    // `runWithRequestContext` has already exited and the tenant store is
    // gone.
    const seenByA = await runWithRequestContext(contextFor(orgA.organizationId), async () =>
      scopedPrisma.roomType.findMany({ select: { id: true } }),
    );
    const idsSeenByA = seenByA.map((row) => row.id);

    expect(idsSeenByA).toContain(a.roomTypeId);
    expect(idsSeenByA).not.toContain(b.roomTypeId);

    // A count is a separate code path from a findMany and has its own
    // chance to leak — a filter applied after the query would still
    // produce a total that includes rows the caller cannot see.
    const countForA = await runWithRequestContext(contextFor(orgA.organizationId), async () =>
      scopedPrisma.roomType.count(),
    );
    expect(countForA).toBe(idsSeenByA.length);
  });

  it("cannot fetch another organization's room type by its real id", async () => {
    const orgA = await loginAsNewOwner('RoomType Org C');
    const orgB = await loginAsNewOwner('RoomType Org D');
    const b = await seedRoomType(orgB.organizationId, `B Suite ${randomUUID().slice(0, 6)}`);

    const stolen = await runWithRequestContext(contextFor(orgA.organizationId), async () =>
      scopedPrisma.roomType.findFirst({ where: { id: b.roomTypeId } }),
    );

    expect(stolen).toBeNull();
  });

  it("cannot update or delete another organization's room type", async () => {
    const orgA = await loginAsNewOwner('RoomType Org E');
    const orgB = await loginAsNewOwner('RoomType Org F');
    const originalName = `B Original ${randomUUID().slice(0, 6)}`;
    const b = await seedRoomType(orgB.organizationId, originalName);

    const updated = await runWithRequestContext(contextFor(orgA.organizationId), async () =>
      scopedPrisma.roomType.updateMany({ where: { id: b.roomTypeId }, data: { name: 'Renamed by A' } }),
    );
    const deleted = await runWithRequestContext(contextFor(orgA.organizationId), async () =>
      scopedPrisma.roomType.deleteMany({ where: { id: b.roomTypeId } }),
    );

    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);

    const survivor = await prisma.roomType.findUnique({ where: { id: b.roomTypeId } });
    expect(survivor?.name).toBe(originalName);
  });
});

describe('the migration backfill left rooms and room types consistent', () => {
  it('every linked room points at a type with the same label, in the same property', async () => {
    // Asserted across the whole table rather than a fixture: the backfill
    // ran once, against whatever rooms existed, and this is the invariant
    // it was supposed to establish. A room created after the migration
    // simply has no type yet, which is why the join is on non-null only.
    const mismatches = await prisma.$queryRawUnsafe<{ n: number }[]>(`
      SELECT count(*)::int AS n
      FROM rooms r
      JOIN room_types rt ON rt.id = r.room_type_id
      WHERE rt.name <> r.room_type OR rt.property_id <> r.property_id
    `);

    expect(mismatches[0]?.n).toBe(0);
  });

  it('the legacy free-text column still exists and still carries every label', async () => {
    // The point of the slice: nothing was dropped. If a later change ever
    // removes `rooms.room_type` before the API stops reading it, this
    // fails rather than the rooms API failing in production.
    const blanks = await prisma.$queryRawUnsafe<{ n: number }[]>(`
      SELECT count(*)::int AS n FROM rooms WHERE room_type IS NULL OR btrim(room_type) = ''
    `);

    expect(blanks[0]?.n).toBe(0);
  });
});
