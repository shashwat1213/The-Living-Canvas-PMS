import { prisma } from '../../lib/prisma.js';
import { UnauthorizedError } from '../../lib/http-errors.js';
import { verifyPassword } from '../../platform/auth/password.js';
import { signAccessToken } from '../../platform/auth/tokens.js';
import { createSession, resolveAuthContext, rotateSession, revokeSession } from '../../platform/auth/session-service.js';

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: PublicUser;
}

async function buildAccessToken(userId: string) {
  const ctx = await resolveAuthContext(userId);
  return signAccessToken({
    sub: ctx.userId,
    organizationId: ctx.organizationId,
    permissions: ctx.permissions,
    roleNames: ctx.roleNames,
    grantedPropertyIds: ctx.grantedPropertyIds,
  });
}

export async function login(email: string, password: string, meta: RequestMeta): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email } });

  // Same error for "no such user" and "wrong password" — a distinct
  // message for the former would let an attacker enumerate registered
  // emails one login attempt at a time.
  if (!user || !user.isActive || !user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw new UnauthorizedError('Invalid email or password.');
  }

  const [accessToken, session] = await Promise.all([buildAccessToken(user.id), createSession(user.id, meta)]);

  return {
    accessToken,
    refreshToken: session.refreshToken,
    refreshExpiresAt: session.expiresAt,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
    },
  };
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export async function refresh(presentedToken: string, meta: RequestMeta): Promise<RefreshResult> {
  const rotated = await rotateSession(presentedToken, meta);
  if (!rotated) {
    throw new UnauthorizedError('Your session has expired — please log in again.');
  }

  const accessToken = await buildAccessToken(rotated.userId);
  return {
    accessToken,
    refreshToken: rotated.session.refreshToken,
    refreshExpiresAt: rotated.session.expiresAt,
  };
}

export async function logout(presentedToken: string): Promise<void> {
  await revokeSession(presentedToken);
}
