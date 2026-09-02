import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';
import { SYSTEM_ROLE_NAMES } from '../../platform/rbac/permissions.js';

/**
 * The role a staff member is created with or moved to. Sourced from
 * `SYSTEM_ROLE_NAMES` rather than a second hand-written list, so a new
 * built-in preset can't be accepted by the API before it actually exists
 * as a seeded `Role` row.
 *
 * Passing validation here does NOT mean the caller may hand this role
 * out — that's the rank check in `service.ts`, which validation can't
 * make because it depends on who is asking.
 */
const systemRoleSchema = z.enum(SYSTEM_ROLE_NAMES);

/** Upper bound on a single grant call — a sanity limit on request size,
 * far above any realistic number of properties one staff member works at. */
const propertyIdsSchema = z.array(z.string().uuid()).max(200);

export const createStaffSchema = z.object({
  email: z.string().email(),
  // Same floor as organization signup (`organizations/schemas.ts`). The
  // creating admin sets an initial password directly: there is no email
  // delivery in the system, so an invite-token flow would have no way to
  // reach the new staff member. See DECISIONS.md.
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  role: systemRoleSchema,
  /** Optional PropertyAccess grants to apply at creation, so a MANAGER or
   * STAFF member isn't created into a state where they can reach nothing. */
  propertyIds: propertyIdsSchema.optional(),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    role: systemRoleSchema,
    /** `false` routes through `platform/auth/revocation.ts`'s
     * `deactivateUser`, never a bare `isActive` write — see service.ts. */
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

/**
 * Query parameters for `GET /staff`: the shared pagination contract plus
 * this module's own filters.
 *
 * All three filters are optional and combine with AND — "active managers
 * matching 'mary'" is one request, not a client-side intersection of
 * three. Filtering server-side is what keeps the endpoint honest at
 * scale: the alternative returns every row and lets the browser hide
 * some, which stops working long before it stops appearing to work.
 */
export const listStaffQuerySchema = paginationQuerySchema.extend({
  /** Free text matched against first name, last name and email. */
  search: z.string().trim().max(120).optional(),
  role: z.enum(SYSTEM_ROLE_NAMES).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;

/** Full replacement of a staff member's property grants — the request
 * body is the complete resulting set, not a delta. */
export const setPropertyAccessSchema = z.object({
  propertyIds: propertyIdsSchema,
});

export type SetPropertyAccessInput = z.infer<typeof setPropertyAccessSchema>;
