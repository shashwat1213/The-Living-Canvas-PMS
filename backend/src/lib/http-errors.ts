/**
 * Typed HTTP errors that the centralized error handler (see
 * `middleware/error-handler.ts`) maps to a status code and a JSON body.
 * Route/service code throws these instead of calling `res.status()`
 * directly, so every error path returns a consistent shape.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'The request was invalid.') {
    super(400, 'bad_request', message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Authentication is required.') {
    super(401, 'unauthorized', message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "You don't have permission to do that.") {
    super(403, 'forbidden', message);
  }
}

/**
 * Deliberately reused for both "doesn't exist" and "exists in another
 * organization" — a tenant-scoped 404 must not distinguish the two, or
 * the response itself leaks which IDs belong to other tenants.
 */
export class NotFoundError extends HttpError {
  constructor(message = 'Not found.') {
    super(404, 'not_found', message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'That already exists.') {
    super(409, 'conflict', message);
  }
}
