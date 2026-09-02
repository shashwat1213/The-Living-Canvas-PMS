import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { getRequestContext } from '../tenancy/context.js';
import type { AuditAction, AuditEntityType } from './actions.js';

/**
 * The two calls this makes, and nothing else.
 *
 * Declared structurally rather than as a concrete Prisma client on
 * purpose: the tenant-scoped client is a *different* generated type from
 * the base one (client extensions rewrite the delegate signatures), so
 * neither `PrismaClient` nor `Prisma.TransactionClient` can stand in for
 * both. Describing only the surface actually used lets every caller pass
 * whatever transaction it is already inside — base client, base
 * transaction, scoped client, or scoped transaction — which is what
 * allows the audit write to join the mutation it describes instead of
 * trailing behind it.
 */
export interface AuditDb {
  user: {
    findFirst(args: {
      where: { id: string };
      select: { email: true };
    }): PromiseLike<{ email: string } | null>;
  };
  auditLog: {
    create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown>;
  };
}

/**
 * Keys that must never reach the audit table. An audit row is long-lived,
 * widely readable within an organization, and returned by an API — it is
 * exactly the wrong place for a credential to end up because someone
 * spread a whole input object into `metadata`.
 *
 * Enforced by stripping rather than by trusting call sites to be careful:
 * a call site that gets it wrong should produce a redacted audit entry,
 * not a leak.
 */
const REDACTED_KEYS = new Set(['password', 'passwordhash', 'token', 'accesstoken', 'refreshtoken', 'secret']);

/**
 * Typed against Prisma's JSON input rather than `unknown`, so a call site
 * that tries to record something unserializable (a Date, a class
 * instance, a function) fails at compile time instead of at the database.
 */
export type AuditMetadata = Record<string, Prisma.InputJsonValue>;

function redact(metadata: AuditMetadata): AuditMetadata {
  const safe: AuditMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) continue;
    safe[key] = value;
  }
  return safe;
}

export interface AuditEvent {
  action: AuditAction;
  entityType: AuditEntityType;
  /** Primary key of the record acted on. */
  entityId: string;
  metadata?: AuditMetadata;
}

/**
 * Writes one audit entry for an action performed in the current request.
 *
 * ## Where the actor and tenant come from
 *
 * Both are read from the request context (`platform/tenancy/context.ts`),
 * never from a parameter. That is deliberate and is what makes the audit
 * trail trustworthy: a caller cannot attribute an action to someone else
 * or file it under another organization, because it has no way to say who
 * it is — the signed access token already decided. It is also what makes
 * this safe for future AI agents: an agent invoking a service inside
 * `runWithRequestContext(...)` is audited under the identity and tenant it
 * was given, with no extra wiring and no way to opt out.
 *
 * ## Why it takes a client
 *
 * Pass the surrounding transaction's client and the audit entry commits or
 * rolls back with the action it describes — no entry for a change that
 * didn't happen, no silent change without an entry. Same optional-client
 * convention as `platform/rbac/provisioning.ts`.
 *
 * Failures are **not** swallowed. Inside a transaction that means an audit
 * failure rolls the action back, which is the intended posture: for a
 * system that may be sold to businesses with compliance obligations, an
 * unrecorded privileged action is a worse outcome than a failed one.
 */
export async function recordAuditEvent(event: AuditEvent, client: AuditDb = prisma): Promise<void> {
  const ctx = getRequestContext();

  // Captured at write time so the row stays meaningful even if the account
  // is later removed (the FK is SetNull for exactly that reason).
  //
  // `findFirst`, not `findUnique`: when the caller passes a tenant-scoped
  // client the extension adds `organizationId` to the where-clause, and
  // `findFirst` accepts that without caring whether the combination is a
  // declared unique. It also means the lookup is tenant-checked when it
  // can be, and identical otherwise.
  const actor = await client.user.findFirst({
    where: { id: ctx.userId },
    select: { email: true },
  });

  await client.auditLog.create({
    data: {
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorUserId: ctx.userId,
      actorEmail: actor?.email ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata ? redact(event.metadata) : undefined,
    },
  });
}
