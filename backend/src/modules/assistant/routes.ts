import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { chatRequestSchema } from './schemas.js';
import { activeProviderKey, answer, answerStream } from './service.js';

/**
 * The in-app AI assistant for a property — a read-only chat grounded in the
 * property's live operational data.
 *
 * Mounted at /properties/:propertyId/assistant, so `requirePropertyAccess`
 * runs before the handler exactly as every other property sub-route does. It
 * is guarded by `dashboard:read`: the assistant answers from the same
 * operational snapshot the dashboard exposes (arrivals, occupancy,
 * housekeeping, maintenance, unsettled folios), so anyone who may read that
 * cockpit may ask the assistant about it, and no one else. Read-only — it
 * writes nothing and takes no audit entry.
 */
export const assistantRouter = Router({ mergeParams: true });

assistantRouter.use(authenticate, requirePropertyAccess());

assistantRouter.post(
  '/chat',
  requirePermission('dashboard:read'),
  asyncHandler(async (req, res) => {
    const input = chatRequestSchema.parse(req.body);
    const result = await answer(req.params.propertyId as string, input);
    res.json(result);
  }),
);

/**
 * Streaming variant of /chat over Server-Sent Events. Emits:
 *   event: meta   — { provider }           (once, first)
 *   event: delta  — { text }               (per token chunk)
 *   event: done   — {}                      (on success)
 *   event: error  — { message }            (if generation fails mid-stream)
 *
 * The request body is validated the same way as /chat BEFORE the SSE stream is
 * opened, so a bad request still returns a normal JSON 400. Once the headers
 * are flushed the response is a 200 event-stream; a provider failure after that
 * point is reported as an `error` event rather than an HTTP status, since the
 * status line is already sent.
 */
assistantRouter.post(
  '/chat/stream',
  requirePermission('dashboard:read'),
  asyncHandler(async (req, res) => {
    const input = chatRequestSchema.parse(req.body);
    const propertyId = req.params.propertyId as string;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      send('meta', { provider: activeProviderKey() });
      for await (const delta of answerStream(propertyId, input)) {
        send('delta', { text: delta });
      }
      send('done', {});
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The assistant could not respond.';
      send('error', { message });
    } finally {
      res.end();
    }
  }),
);
