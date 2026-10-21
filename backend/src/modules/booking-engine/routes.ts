import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { ipRateLimit } from '../../platform/http/ip-rate-limit.js';
import { book, getPublicProperty, search } from './service.js';
import { bookRequestSchema, searchQuerySchema } from './schemas.js';

/**
 * The public, UNAUTHENTICATED booking engine — the only surface a guest hits
 * without logging in. Mounted at /api/v1/book (NOT under /properties, and NOT
 * behind `authenticate`): a property is addressed by its public `slug`, the
 * organization is resolved server-side, and all tenant-scoped work runs inside
 * a system context (see service.ts). Read/search is open; booking is
 * per-IP rate-limited to blunt abuse. No internal ids or other tenants' data
 * are ever exposed.
 */
export const bookingEngineRouter = Router();

const searchLimit = ipRateLimit({ windowMs: 60_000, max: 60, name: 'booking-search' });
const bookLimit = ipRateLimit({ windowMs: 60_000, max: 10, name: 'booking-book' });

// Public property page (name + location).
bookingEngineRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const property = await getPublicProperty(req.params.slug as string);
    res.json({ property });
  }),
);

// Availability + pricing search for a date window.
bookingEngineRouter.get(
  '/:slug/search',
  searchLimit,
  asyncHandler(async (req, res) => {
    const query = searchQuerySchema.parse(req.query);
    const result = await search(req.params.slug as string, query);
    res.json(result);
  }),
);

// Create a booking. Re-prices and re-checks availability server-side; the
// client's quoted price is never trusted.
bookingEngineRouter.post(
  '/:slug/book',
  bookLimit,
  asyncHandler(async (req, res) => {
    const input = bookRequestSchema.parse(req.body);
    const confirmation = await book(req.params.slug as string, input);
    res.status(201).json({ confirmation });
  }),
);
