import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';

interface CacheEntry {
  value: Date | null;
  cachedAt: number;
}

/**
 * In-process cache for `User.tokensValidAfter` (Phase 1 decision —
 * "token-revocation watermark", see DECISIONS.md). Same shape and
 * opportunistic-prune idiom as `platform/auth/rate-limit.ts`, reused
 * deliberately rather than inventing a second pattern.
 *
 * Single-process only, same caveat as the rate limiter: this needs a
 * shared store (e.g. Redis) before running more than one API process,
 * since each process would otherwise track its own independent cache.
 */
const cache = new Map<string, CacheEntry>();

function ttlMs(): number {
  return env.auth.tokensValidAfterCacheTtlSeconds * 1000;
}

function prune(now: number): void {
  if (cache.size < 10_000) return;
  for (const [userId, entry] of cache) {
    if (now - entry.cachedAt > ttlMs()) {
      cache.delete(userId);
    }
  }
}

/**
 * Resolves a user's revocation watermark: cache-first (including a
 * cached `null`, the common case for a user who's never been
 * deactivated — this is what avoids a database hit on every request, not
 * just for revoked users), database fallback on a miss or an expired
 * entry.
 *
 * Fails closed: a database error on the fallback lookup — and a missing
 * user, treated the same as "definitely revoked" rather than "no floor"
 * — is NOT swallowed here. It propagates so `authenticate` rejects the
 * request rather than treating an unreachable database (or a deleted
 * user) as equivalent to "confirmed not revoked."
 */
export async function getTokensValidAfter(userId: string): Promise<Date | null> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && now - cached.cachedAt < ttlMs()) {
    return cached.value;
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { tokensValidAfter: true },
  });

  prune(now);
  cache.set(userId, { value: user.tokensValidAfter, cachedAt: now });
  return user.tokensValidAfter;
}

/**
 * Proactively evicts a user's cached watermark. Called by
 * `platform/auth/revocation.ts` immediately after writing a new
 * watermark, so the process performing a revocation enforces it right
 * away in its own subsequent requests rather than waiting out the cache
 * TTL — other processes (if any) still pick it up only once their own
 * cache entry expires.
 */
export function invalidateCachedTokensValidAfter(userId: string): void {
  cache.delete(userId);
}
