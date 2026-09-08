import type { RatePlan, RatePlanRate } from '@prisma/client';

import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { withUniqueConstraintGuard } from '../../lib/prisma-errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { ratePlansRepository, type RatePlanWithUsage } from './repository.js';
import type { CreateRatePlanInput, ListRatePlansQuery, ListRatesQuery, SetRatesInput, UpdateRatePlanInput } from './schemas.js';

const NAME_TAKEN = 'A rate plan with that name already exists for this room type.';
const CODE_TAKEN = 'A rate plan with that code already exists for this room type.';

export function listRatePlans(
  propertyId: string,
  roomTypeId: string,
  query: ListRatePlansQuery,
): Promise<{ items: RatePlanWithUsage[]; page: PageMeta }> {
  return ratePlansRepository.list(propertyId, roomTypeId, query);
}

export async function getRatePlan(propertyId: string, roomTypeId: string, id: string): Promise<RatePlanWithUsage> {
  const ratePlan = await ratePlansRepository.findById(propertyId, roomTypeId, id);
  if (!ratePlan) {
    throw new NotFoundError('Rate plan not found.');
  }
  return ratePlan;
}

type FieldChange = { from: string | number | boolean | null; to: string | number | boolean | null };

function diffRatePlan(before: RatePlan, after: RatePlan): Record<string, FieldChange> {
  const tracked = ['name', 'code', 'description', 'isRefundable', 'isActive'] as const;
  const changed: Record<string, FieldChange> = {};
  for (const field of tracked) {
    if (before[field] !== after[field]) {
      changed[field] = { from: before[field], to: after[field] };
    }
  }
  return changed;
}

async function assertNameAndCodeFree(
  roomTypeId: string,
  input: { name?: string; code?: string | null },
  excludingId?: string,
): Promise<void> {
  if (input.name) {
    const existing = await ratePlansRepository.findByName(roomTypeId, input.name);
    if (existing && existing.id !== excludingId) {
      throw new ConflictError(NAME_TAKEN);
    }
  }
  if (input.code) {
    const existing = await ratePlansRepository.findByCode(roomTypeId, input.code);
    if (existing && existing.id !== excludingId) {
      throw new ConflictError(CODE_TAKEN);
    }
  }
}

export async function createRatePlan(
  propertyId: string,
  roomTypeId: string,
  input: CreateRatePlanInput,
): Promise<RatePlanWithUsage> {
  await assertNameAndCodeFree(roomTypeId, input);

  const created = await withUniqueConstraintGuard(
    () =>
      scopedPrisma.$transaction(async (tx) => {
        const ratePlan = await ratePlansRepository.create(propertyId, roomTypeId, input, tx);
        await recordAuditEvent(
          {
            action: AUDIT_ACTIONS.RATE_PLAN_CREATED,
            entityType: AUDIT_ENTITY_TYPES.RATE_PLAN,
            entityId: ratePlan.id,
            metadata: {
              propertyId,
              roomTypeId,
              name: ratePlan.name,
              isRefundable: ratePlan.isRefundable,
              ...(ratePlan.code ? { code: ratePlan.code } : {}),
            },
          },
          tx,
        );
        return ratePlan;
      }),
    NAME_TAKEN,
  );

  return getRatePlan(propertyId, roomTypeId, created.id);
}

export async function updateRatePlan(
  propertyId: string,
  roomTypeId: string,
  id: string,
  input: UpdateRatePlanInput,
): Promise<RatePlanWithUsage> {
  const before = await getRatePlan(propertyId, roomTypeId, id);
  await assertNameAndCodeFree(roomTypeId, input, id);

  await withUniqueConstraintGuard(
    () =>
      scopedPrisma.$transaction(async (tx) => {
        const ratePlan = await ratePlansRepository.update(roomTypeId, id, input, tx);

        const changed = diffRatePlan(before, ratePlan);
        if (Object.keys(changed).length > 0) {
          await recordAuditEvent(
            {
              action: AUDIT_ACTIONS.RATE_PLAN_UPDATED,
              entityType: AUDIT_ENTITY_TYPES.RATE_PLAN,
              entityId: ratePlan.id,
              metadata: { propertyId, roomTypeId, name: ratePlan.name, changed },
            },
            tx,
          );
        }
        return ratePlan;
      }),
    NAME_TAKEN,
  );

  return getRatePlan(propertyId, roomTypeId, id);
}

/**
 * A rate plan is hard-deletable — unlike a room type, nothing physical points
 * at it, and its per-date rates cascade away with it. The guard here is
 * against deleting a plan a *reservation* references, which reservations
 * (Slice B) will enforce; until then the only dependents are the plan's own
 * rate rows. Retirement via `isActive: false` remains the softer option and
 * is what the UI leads with.
 */
export async function deleteRatePlan(propertyId: string, roomTypeId: string, id: string): Promise<void> {
  const ratePlan = await getRatePlan(propertyId, roomTypeId, id);

  await scopedPrisma.$transaction(async (tx) => {
    await ratePlansRepository.remove(roomTypeId, id, tx);
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.RATE_PLAN_DELETED,
        entityType: AUDIT_ENTITY_TYPES.RATE_PLAN,
        entityId: id,
        metadata: {
          propertyId,
          roomTypeId,
          name: ratePlan.name,
          ...(ratePlan.code ? { code: ratePlan.code } : {}),
        },
      },
      tx,
    );
  });
}

export async function listRates(
  propertyId: string,
  roomTypeId: string,
  ratePlanId: string,
  query: ListRatesQuery,
): Promise<{ ratePlanId: string; from: string; to: string; rates: { date: string; amountMinor: number }[] }> {
  // Resolves the plan through the full parent chain first (404 on any break).
  await getRatePlan(propertyId, roomTypeId, ratePlanId);
  const rows = await ratePlansRepository.listRates(ratePlanId, query.from, query.to);
  return {
    ratePlanId,
    from: toIsoDate(query.from),
    to: toIsoDate(query.to),
    rates: rows.map((r) => ({ date: toIsoDate(r.date), amountMinor: r.amountMinor })),
  };
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Bulk-set (or clear) per-date rates for a plan.
 *
 * A price of `null` clears that date (deletes the row); a number upserts it.
 * The whole batch commits in one transaction so a partial edit can't leave
 * the calendar half-written, and one audit entry records the range and count
 * rather than one entry per night — a month's repricing is a single action a
 * revenue manager took, not thirty.
 */
export async function setRates(
  propertyId: string,
  roomTypeId: string,
  ratePlanId: string,
  input: SetRatesInput,
): Promise<{ set: number; cleared: number }> {
  const ratePlan = await getRatePlan(propertyId, roomTypeId, ratePlanId);

  const toSet = input.rates.filter((r) => r.amountMinor !== null);
  const toClear = input.rates.filter((r) => r.amountMinor === null);

  await scopedPrisma.$transaction(async (tx) => {
    for (const { date, amountMinor } of toSet) {
      await tx.ratePlanRate.upsert({
        where: { ratePlanId_date: { ratePlanId, date } },
        create: { ratePlanId, date, amountMinor: amountMinor as number },
        update: { amountMinor: amountMinor as number },
      });
    }
    if (toClear.length > 0) {
      await tx.ratePlanRate.deleteMany({
        where: { ratePlanId, date: { in: toClear.map((r) => r.date) } },
      });
    }

    const dates = input.rates.map((r) => toIsoDate(r.date)).sort();
    // `rates` is `.min(1)`, so first/last always exist.
    const from = dates[0] as string;
    const to = dates[dates.length - 1] as string;
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.RATE_PLAN_RATES_SET,
        entityType: AUDIT_ENTITY_TYPES.RATE_PLAN,
        entityId: ratePlanId,
        metadata: {
          propertyId,
          roomTypeId,
          name: ratePlan.name,
          set: toSet.length,
          cleared: toClear.length,
          from,
          to,
        },
      },
      tx,
    );
  });

  return { set: toSet.length, cleared: toClear.length };
}

export type { RatePlanRate };
