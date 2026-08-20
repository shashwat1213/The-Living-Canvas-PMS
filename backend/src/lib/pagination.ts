import { z } from 'zod';

/**
 * Shared pagination contract for list endpoints.
 *
 * Every list endpoint in this API is paginated — an endpoint that returns
 * "all rows" is a liability that only shows up once a real customer has
 * enough data to make it one, and by then the response shape is already
 * public. Establishing the envelope here means each new module
 * (properties, units, leases, maintenance…) inherits the same query
 * parameters, the same defaults, and the same response shape rather than
 * inventing its own.
 *
 * What this file deliberately does NOT own: filtering and sorting.
 * Those differ per module and belong to the module that knows its own
 * columns. Only the page/pageSize contract and the resulting metadata are
 * general enough to share.
 */

export const DEFAULT_PAGE_SIZE = 25;

/**
 * Hard ceiling on a single response. A caller asking for more gets a
 * validation error rather than a silently truncated page, so a client
 * can't quietly believe it received everything.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Query-parameter fragment for a paginated endpoint. Modules extend this
 * with their own filters:
 *
 *   export const listStaffQuerySchema = paginationQuerySchema.extend({
 *     search: z.string().trim().max(120).optional(),
 *   });
 *
 * `coerce` is required because query-string values arrive as strings.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** The `page` object returned alongside every paginated list's rows. */
export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/** Translates a validated page/pageSize into Prisma's skip/take. */
export function toSkipTake(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/**
 * Builds the response metadata.
 *
 * `totalPages` is at least 1 even when there are no results, so a client
 * rendering "page 1 of N" never displays "page 1 of 0". The requested
 * page is echoed back as-is rather than clamped: a caller asking for page
 * 9 of a 3-page result gets an empty page 9, which is a truthful answer
 * and lets the client decide what to do, instead of silently receiving
 * page 3 and believing it asked for it.
 */
export function buildPageMeta(query: PaginationQuery, totalItems: number): PageMeta {
  return {
    page: query.page,
    pageSize: query.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
  };
}

/** The shape every paginated list response follows. */
export interface Paginated<T> {
  items: T[];
  page: PageMeta;
}
