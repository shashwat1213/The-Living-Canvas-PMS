import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

/** Mirrors the `MarketingContentFormat` enum. */
export const MARKETING_FORMATS = ['SOCIAL_POST', 'EMAIL', 'PROMO_DESCRIPTION', 'TAGLINE'] as const;
/** Mirrors the `MarketingContentStatus` enum. */
export const MARKETING_STATUSES = ['GENERATING', 'DRAFT', 'APPROVED', 'DISCARDED', 'FAILED'] as const;

/**
 * Request a new piece of copy. `brief` is required (there is nothing to
 * generate from otherwise); `tone` is an optional voice hint. Bounds keep a
 * runaway prompt out of the queue.
 */
export const createContentSchema = z.object({
  format: z.enum(MARKETING_FORMATS),
  brief: z.string().trim().min(3).max(2000),
  tone: z.string().trim().max(60).optional(),
});
export type CreateContentInput = z.infer<typeof createContentSchema>;

/**
 * Edit a draft's text. At least one field must be present (an empty PATCH is
 * a 400, not a silent no-op). `title` is nullable so it can be cleared;
 * `editedBody` is the staff-authoritative body once set.
 */
export const updateContentSchema = z
  .object({
    title: z.string().trim().max(200).nullable(),
    editedBody: z.string().trim().min(1).max(5000),
  })
  .partial()
  .refine((v) => v.title !== undefined || v.editedBody !== undefined, {
    message: 'Provide at least one field to update.',
  });
export type UpdateContentInput = z.infer<typeof updateContentSchema>;

/**
 * Query parameters for the content list: shared pagination plus filters by
 * format and status, and a free-text search across brief/title/body.
 */
export const listContentQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  format: z.enum(MARKETING_FORMATS).optional(),
  status: z.enum(MARKETING_STATUSES).optional(),
});
export type ListContentQuery = z.infer<typeof listContentQuerySchema>;
