import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import type { Permission, SystemRoleName } from '../rbac/permissions.js';
import { generateRefreshToken, hashRefreshToken } from './tokens.js';

export interface ResolvedAuthContext {
  userId: string;
  organizationId: string;
  permissions: Permission[];
  roleNames: SystemRoleName[];
  grantedPropertyIds: string[];
}

/**
 * Resolves a user's permissions from the database — walks
 * User -> UserRoleAssignment -> Role -> RolePermission -> Permission,
 * plus their PropertyAccess grants. Called at login and at every refresh,
 * so a role/permission change takes effect on the user's next token
 * refresh rather than requiring them to log out.
 *
 * Deliberately uses the base (unscoped) `prisma` client, not the
 * tenant-scoped one — this function is what *establishes* tenant
 * context, so it can't depend on it already being set.
 */
export async function resolveAuthContext(userId: string): Promise<ResolvedAuthContext> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      roleAssignments: {
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      },
      propertyAccess: true,
    },
  });

  const permissions = new Set<Permission>();
  const roleNames = new Set<SystemRoleName>();
  for (const assignment of user.roleAssignments) {
    roleNames.add(assignment.role.name as SystemRoleName);
    for (const rp of assignment.role.rolePermissions) {
      permissions.add(rp.permission.key as Permission);
    }
  }

  return {
    userId: user.id,
    organizationId: user.organizationId,
    permissions: [...permissions],
    roleNames: [...roleNames],
    grantedPropertyIds: user.propertyAccess.map((grant) => grant.propertyId),
  };
}

export interface IssuedSession {
  refreshToken: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt,
    },
  });

  return { refreshToken, expiresAt };
}

/**
 * Rotates a refresh token: the presented token is looked up, checked for
 * validity (not revoked, not expired), revoked, and replaced with a new
 * one — so a stolen-then-reused refresh token is detectable (the
 * original session is already revoked by the time an attacker replays
 * it) rather than remaining valid indefinitely.
 */
export async function rotateSession(
  presentedToken: string,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<{ userId: string; session: IssuedSession } | null> {
  const tokenHash = hashRefreshToken(presentedToken);
  const existing = await prisma.session.findUnique({ where: { refreshTokenHash: tokenHash } });

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    return null;
  }

  await prisma.session.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
  const session = await createSession(existing.userId, meta);
  return { userId: existing.userId, session };
}

export async function revokeSession(presentedToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(presentedToken);
  await prisma.session.updateMany({
    where: { refreshTokenHash: tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
