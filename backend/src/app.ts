import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';

import { env } from './config/env.js';
import { NotFoundError } from './lib/http-errors.js';
import { errorHandler } from './middleware/error-handler.js';
import { auditRouter } from './modules/audit/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { availabilityRouter } from './modules/availability/routes.js';
import { foliosRouter } from './modules/folios/routes.js';
import { organizationsRouter } from './modules/organizations/routes.js';
import { guestsRouter } from './modules/guests/routes.js';
import { propertiesRouter } from './modules/properties/routes.js';
import { ratePlansRouter } from './modules/rate-plans/routes.js';
import { reservationsRouter } from './modules/reservations/routes.js';
import { roomTypesRouter } from './modules/room-types/routes.js';
import { roomsRouter } from './modules/rooms/routes.js';
import { staffRouter } from './modules/staff/routes.js';
import { healthRouter } from './routes/health.js';

export function createApp(): Express {
  const app = express();

  // `credentials: true` + an explicit (not wildcard) origin is required
  // for the browser to send/accept the httpOnly refresh-token cookie
  // across the frontend/backend origin split (see platform/auth/cookies.ts).
  app.use(cors({ origin: env.frontendUrl, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.use(healthRouter);

  const v1 = express.Router();
  v1.use(authRouter);
  v1.use(organizationsRouter);
  v1.use(staffRouter);
  v1.use(auditRouter);
  v1.use(guestsRouter);
  v1.use(propertiesRouter);
  v1.use('/properties/:propertyId/rooms', roomsRouter);
  v1.use('/properties/:propertyId/room-types', roomTypesRouter);
  v1.use('/properties/:propertyId/room-types/:roomTypeId/rate-plans', ratePlansRouter);
  v1.use('/properties/:propertyId/reservations', reservationsRouter);
  v1.use('/properties/:propertyId/reservations/:reservationId/folio', foliosRouter);
  v1.use('/properties/:propertyId/availability', availabilityRouter);
  app.use('/api/v1', v1);

  // Nothing matched. Handing a NotFoundError to `errorHandler` rather than
  // responding here keeps the body identical to every other error the API
  // returns — without this, Express's default handler answers a typo'd URL
  // with an HTML page a JSON client can't parse.
  app.use((_req, _res, next) => {
    next(new NotFoundError('The requested endpoint does not exist.'));
  });

  app.use(errorHandler);

  return app;
}
