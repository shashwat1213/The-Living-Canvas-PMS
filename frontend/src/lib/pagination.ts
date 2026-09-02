/**
 * Client-side mirror of the API's pagination contract
 * (`backend/src/lib/pagination.ts`). Shared by every feature that lists
 * things, so a module doesn't invent its own page shape or its own way of
 * building a query string.
 */

/** The `page` object every paginated list response carries. */
export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export const DEFAULT_PAGE_SIZE = 25;

/**
 * Builds a query string from a params object, dropping anything empty so
 * the URL only carries filters that are actually applied — an
 * `?search=&role=` request is noise, and omitting a parameter is how the
 * API's own defaults get used.
 */
export function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
