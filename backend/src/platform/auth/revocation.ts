import { prisma } from '../../lib/prisma.js';
import { invalidateCachedTokensValidAfter } from './revocation-cache.js';
import { revokeAllSessionsForUser } from './session-service.js';

/**
 * Invalidates every access token issued before now for this user —
 * `authenticate` (`tenancy/middleware.ts`) rejects any token whose `iat`
 * predates this watermark, regardless of the token's own expiry. Use
 * this whenever outstanding access tokens need to stop working
 * immediately (bounded by the revocation-cache TTL); it does not touch
 * refresh sessions — pair with `revokeAllSessionsForUser` (see
 * `deactivateUser` below) when both need to die together.
 *
 * Deliberately not wired to any route yet — Phase 1 has no staff
 * deactivation endpoint (see TASKS.md). This exists as the seam a future
 * task calls into, so that work doesn't have to reinvent it or forget to
 * bump the watermark while it's at it.
 */
export async function bumpTokensValidAfter(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tokensValidAfter: new Date() } });
  invalidateCachedTokensValidAfter(userId);
}

/**
 * The one sanctioned way to deactivate a user. Composes `isActive: false`
 * with the revocation watermark in a single write, then revokes every
 * outstanding session — so a deactivated user's already-issued access
 * token AND their refresh cookie both stop working, not just one or the
 * other. Centralizing this is what stops a future endpoint from setting
 * `isActive: false` by hand and forgetting the rest.
 */
export async function deactivateUser(userId: string): Promise<void> {
  const now = new Date();
  await prisma.user.update({ where: { id: userId }, data: { isActive: false, tokensValidAfter: now } });
  invalidateCachedTokensValidAfter(userId);
  await revokeAllSessionsForUser(userId);
}
