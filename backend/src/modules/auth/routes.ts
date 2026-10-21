import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { UnauthorizedError } from '../../lib/http-errors.js';
import { REFRESH_COOKIE_NAME, clearRefreshCookie, setRefreshCookie } from '../../platform/auth/cookies.js';
import { loginRateLimit } from '../../platform/auth/rate-limit.js';
import { ipRateLimit } from '../../platform/http/ip-rate-limit.js';
import { requireHuman } from '../../platform/http/turnstile.js';
import { getRequestContext } from '../../platform/tenancy/context.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import * as account from './account.service.js';
import {
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  tokenSchema,
} from './schemas.js';
import * as authService from './service.js';

export const authRouter = Router();

function requestMeta(req: import('express').Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}

// Email-sending and token-guessing endpoints get their own tight budgets.
const emailRateLimit = ipRateLimit({ name: 'auth-email', windowMs: 15 * 60 * 1000, max: 5, skipInTest: true });
const tokenRateLimit = ipRateLimit({ name: 'auth-token', windowMs: 15 * 60 * 1000, max: 20, skipInTest: true });

authRouter.post(
  '/auth/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const result = await authService.login(email, password, requestMeta(req));
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    res.json({ accessToken: result.accessToken, user: result.user });
  }),
);

authRouter.post(
  '/auth/refresh',
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedError('No refresh session present.');
    }
    const result = await authService.refresh(token, requestMeta(req));
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    res.json({ accessToken: result.accessToken });
  }),
);

authRouter.post(
  '/auth/logout',
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (token) {
      await authService.logout(token);
    }
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/auth/me',
  authenticate,
  asyncHandler(async (_req, res) => {
    const user = await account.getProfile(getRequestContext().userId);
    res.json({ user });
  }),
);

authRouter.post(
  '/auth/verify-email',
  tokenRateLimit,
  asyncHandler(async (req, res) => {
    const { token } = tokenSchema.parse(req.body);
    await account.verifyEmail(token);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/auth/resend-verification',
  emailRateLimit,
  authenticate,
  asyncHandler(async (_req, res) => {
    await account.sendVerificationEmail(getRequestContext().userId);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/auth/forgot-password',
  emailRateLimit,
  requireHuman,
  asyncHandler(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    await account.requestPasswordReset(email);
    // Identical response whether or not the account exists.
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/auth/reset-password',
  tokenRateLimit,
  asyncHandler(async (req, res) => {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await account.resetPassword(token, password);
    clearRefreshCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.delete(
  '/auth/account',
  tokenRateLimit,
  authenticate,
  asyncHandler(async (req, res) => {
    const { password } = deleteAccountSchema.parse(req.body);
    const result = await account.deleteAccount(getRequestContext().userId, password);
    clearRefreshCookie(res);
    res.json(result);
  }),
);
