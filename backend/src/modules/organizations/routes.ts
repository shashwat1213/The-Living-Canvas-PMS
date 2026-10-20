import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { prisma } from '../../lib/prisma.js';
import { ipRateLimit } from '../../platform/http/ip-rate-limit.js';
import { requireHuman } from '../../platform/http/turnstile.js';
import { sendVerificationEmail } from '../auth/account.service.js';
import { requirePermission } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { createOrganizationSchema, updateOrganizationSchema } from './schemas.js';
import * as organizationsService from './service.js';

export const organizationsRouter = Router();

// Public — this is how a brand-new tenant is bootstrapped, so there is
// deliberately no authenticated caller yet at this one endpoint.
const signupRateLimit = ipRateLimit({ name: 'signup', windowMs: 60 * 60 * 1000, max: 10, skipInTest: true });

organizationsRouter.post(
  '/organizations',
  signupRateLimit,
  requireHuman,
  asyncHandler(async (req, res) => {
    const input = createOrganizationSchema.parse(req.body);
    const { organization } = await organizationsService.createOrganization(input);
    const owner = await prisma.user.findUnique({ where: { email: input.owner.email } });
    if (owner) {
      // Best-effort: a mail outage must not fail a signup that already committed.
      await sendVerificationEmail(owner.id).catch((error: unknown) =>
        console.error('[signup] verification email failed', error),
      );
    }
    res.status(201).json({ organization });
  }),
);

organizationsRouter.get(
  '/organizations/me',
  authenticate,
  requirePermission('organizations:read'),
  asyncHandler(async (_req, res) => {
    const organization = await organizationsService.getOwnOrganization();
    res.json({ organization });
  }),
);

organizationsRouter.patch(
  '/organizations/me',
  authenticate,
  requirePermission('organizations:update'),
  asyncHandler(async (req, res) => {
    const input = updateOrganizationSchema.parse(req.body);
    const organization = await organizationsService.updateOwnOrganization(input);
    res.json({ organization });
  }),
);
