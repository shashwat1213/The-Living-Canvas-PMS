import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { UnauthorizedError } from '../../lib/http-errors.js';
import { REFRESH_COOKIE_NAME, clearRefreshCookie, setRefreshCookie } from '../../platform/auth/cookies.js';
import { loginRateLimit } from '../../platform/auth/rate-limit.js';
import { loginSchema } from './schemas.js';
import * as authService from './service.js';

export const authRouter = Router();

function requestMeta(req: import('express').Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}

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
