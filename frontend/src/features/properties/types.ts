/**
 * Domain types for properties, mirroring what
 * `backend/src/modules/properties` returns and accepts.
 */

export interface Property {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Server-side filters accepted by `GET /api/v1/properties`. */
export interface PropertyListParams {
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  page?: number;
  pageSize?: number;
}

export interface CreatePropertyInput {
  name: string;
  slug: string;
  timezone?: string;
  addressLine1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

/** Every field optional; `isActive` is update-only. */
export type UpdatePropertyInput = Partial<CreatePropertyInput> & { isActive?: boolean };

/** A one-line location summary, or null when no address was recorded. */
export function locationLabel(property: Property): string | null {
  const parts = [property.city, property.region, property.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}
