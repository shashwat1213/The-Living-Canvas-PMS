import { createHash, randomBytes } from 'node:crypto';

import type { AuthTokenPurpose } from '@prisma/client';

import { env } from '../../config/env.js';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../lib/http-errors.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../platform/auth/password.js';
import { renderActionEmail, sendEmail } from '../../platform/email/mailer.js';

/**
 * Account lifecycle that sits outside a tenant request context: email
 * verification, password reset, and self-service account deletion.
 *
 * These run on the base client on purpose — a reset-link click has no
 * logged-in caller, and deleting an organization must reach every one of its
 * rows. Each function looks the user up by an unguessable token or by the
 * authenticated caller's own id, never by a client-supplied tenant id.
 */

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function issueToken(userId: string, purpose: AuthTokenPurpose, ttlMs: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await prisma.$transaction([
    // Only the newest link of each kind works — requesting a fresh one
    // invalidates any older, possibly-leaked link.
    prisma.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.authToken.create({
      data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return token;
}

/** Atomically consumes a valid token; returns its user id or throws. */
async function consumeToken(token: string, purpose: AuthTokenPurpose): Promise<string> {
  const now = new Date();
  const record = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt < now) {
    throw new BadRequestError('This link is invalid or has expired. Please request a new one.');
  }
  // Conditional update = single use even under a double-click race.
  const { count } = await prisma.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  });
  if (count !== 1) {
    throw new BadRequestError('This link has already been used.');
  }
  return record.userId;
}

function link(path: string, token: string): string {
  return `${env.appUrl.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
}

export async function sendVerificationEmail(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.emailVerifiedAt) return;
  const token = await issueToken(user.id, 'EMAIL_VERIFICATION', VERIFY_TTL_MS);
  const { html, text } = renderActionEmail({
    greetingName: user.firstName,
    heading: 'Confirm your email address',
    body: 'Welcome to The Living Canvas. Please confirm this is your email address so we can keep your account secure and send you important notices.',
    actionLabel: 'Verify email',
    actionUrl: link('/verify-email', token),
    footnote: 'This link expires in 24 hours. If you did not create an account, you can ignore this email.',
  });
  await sendEmail({ to: user.email, subject: 'Verify your email — The Living Canvas', html, text });
}

export async function verifyEmail(token: string): Promise<void> {
  const userId = await consumeToken(token, 'EMAIL_VERIFICATION');
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
}

/**
 * Always resolves the same way whether or not the email exists, so the
 * endpoint cannot be used to discover which addresses have accounts.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });
  if (!user || !user.isActive || user.email.toLowerCase() === env.demoEmail) return;
  const token = await issueToken(user.id, 'PASSWORD_RESET', RESET_TTL_MS);
  const { html, text } = renderActionEmail({
    greetingName: user.firstName,
    heading: 'Reset your password',
    body: 'We received a request to reset the password for your Living Canvas account. Click the button below to choose a new one.',
    actionLabel: 'Choose a new password',
    actionUrl: link('/reset-password', token),
    footnote: "This link expires in 1 hour and can be used once. If you didn't ask for this, you can safely ignore this email — your password won't change.",
  });
  await sendEmail({ to: user.email, subject: 'Reset your password — The Living Canvas', html, text });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const userId = await consumeToken(token, 'PASSWORD_RESET');
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();
  await prisma.$transaction([
    // A reset proves inbox ownership, so it also verifies the address.
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokensValidAfter: now, emailVerifiedAt: now },
    }),
    // Sign out every device: whoever had the old password loses access.
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      organizationId: true,
      emailVerifiedAt: true,
      createdAt: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!user) throw new NotFoundError();
  return { ...user, isDemo: user.email.toLowerCase() === env.demoEmail };
}

/**
 * Deletes the caller's account. If they are the organization's only OWNER,
 * the whole organization (hotel, properties, bookings, guests…) goes with it
 * — an org with no owner would be unmanageable. Otherwise only their user
 * record is removed. Requires the current password.
 */
export async function deleteAccount(userId: string, password: string): Promise<{ deletedOrganization: boolean }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError();
  if (user.email.toLowerCase() === env.demoEmail) {
    throw new ForbiddenError('The shared demo account cannot be deleted. Create your own account to try this.');
  }
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw new UnauthorizedError('Password is incorrect.');
  }

  const otherOwners = await prisma.user.count({
    where: { organizationId: user.organizationId, role: 'OWNER', isActive: true, id: { not: user.id } },
  });

  if (user.role === 'OWNER' && otherOwners === 0) {
    await deleteOrganizationCompletely(user.organizationId);
    return { deletedOrganization: true };
  }

  await prisma.user.delete({ where: { id: user.id } });
  return { deletedOrganization: false };
}

/**
 * Some foreign keys are RESTRICT on purpose (a room type cannot vanish from
 * under a booking), so a plain cascading `DELETE organizations` would be
 * refused. Delete leaf-first in one transaction instead; the final org delete
 * cascades the rest (users, sessions, roles, guests, audit, jobs, …).
 */
async function deleteOrganizationCompletely(organizationId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const props = { property: { organizationId } };
    await tx.posOrderItem.deleteMany({ where: { order: props } });
    await tx.posOrder.deleteMany({ where: props });
    await tx.posProduct.deleteMany({ where: { outlet: props } });
    await tx.posOutlet.deleteMany({ where: props });
    await tx.reservation.deleteMany({ where: props });
    await tx.reservationGroup.deleteMany({ where: props });
    await tx.ratePlan.deleteMany({ where: { roomType: props } });
    await tx.room.deleteMany({ where: props });
    await tx.roomType.deleteMany({ where: props });
    await tx.organization.delete({ where: { id: organizationId } });
  });
}
