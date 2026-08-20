import { prisma } from '../../lib/prisma.js';
import { invalidateCachedTokensValidAfter } from './revocation-cache.js';
import { revokeAllSessionsForUser } from './session-service.js';

/** The models `deactivateUser` writes — satisfied by the base client or a transaction of it. */
type RevocationDb = Pick<typeof prisma, 'user' | 'session'>;

/**
 * Invalidates every access token issued before now for this user —
 * `authenticate` (`tenancy/middleware.ts`) rejects any token whose `iat`
 * predates this watermark, regardless of the token's own expiry.
 *
 * Accepts a transaction client so a caller can commit the invalidation
 * together with the change that motivated it — a role or property-access
 * change that persisted without its matching watermark bump would leave
 * the user holding permissions they no longer have, for up to an access
 * token's lifetime, with the audit trail already saying otherwise.
 *
 * Use this whenever outstanding access tokens need to stop working
 * immediately (bounded by the revocation-cache TTL); it does not touch
 * refresh sessions — pair with `revokeAllSessionsForUser` (see
 * `deactivateUser` below) when both need to die together.
 *
 * Called by `modules/staff/service.ts` whenever a role or property-access
 * change lands: the access token embeds `permissions` and
 * `grantedPropertyIds`, so without this bump a demotion wouldn't take
 * effect until the token expired on its own, and the user would keep
 * operating on authority they had just lost.
 */
export async function bumpTokensValidAfter(userId: string, client: RevocationDb = prisma): Promise<void> {
  await client.user.update({ where: { id: userId }, data: { tokensValidAfter: new Date() } });

  // Cache eviction stays outside the caller's transaction for the same
  // reason as `deactivateUser`: an in-memory eviction cannot be rolled
  // back. Doing it after the write means a rolled-back change leaves at
  // worst a cold cache entry, which simply re-reads the unchanged row.
  invalidateCachedTokensValidAfter(userId);
}

/**
 * The one sanctioned way to deactivate a user. Accepts a transaction
 * client so a caller can commit the deactivation together with its audit
 * entry. Composes `isActive: false`
 * with the revocation watermark in a single write, then revokes every
 * outstanding session — so a deactivated user's already-issued access
 * token AND their refresh cookie both stop working, not just one or the
 * other. Centralizing this is what stops a future endpoint from setting
 * `isActive: false` by hand and forgetting the rest.
 */
export async function deactivateUser(userId: string, client: RevocationDb = prisma): Promise<void> {
  const now = new Date();
  await client.user.update({ where: { id: userId }, data: { isActive: false, tokensValidAfter: now } });
  await revokeAllSessionsForUser(userId, client);

  // Cache eviction happens last and is deliberately *not* part of the
  // caller's transaction — it can't be rolled back. Evicting after the
  // writes means a rolled-back deactivation leaves at worst a cold cache
  // entry, which simply re-reads the (unchanged) row. Evicting first
  // would be equally safe but pointlessly earlier; doing it inside a
  // transaction that later aborts would leave the process enforcing a
  // revocation that never committed.
  invalidateCachedTokensValidAfter(userId);
}
