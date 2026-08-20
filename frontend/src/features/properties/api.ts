import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type { CreatePropertyInput, Property, PropertyListParams, UpdatePropertyInput } from './types';

/**
 * The only place property endpoints are named. Components call these and
 * never build an `/api/v1/properties/...` path themselves, so a contract
 * change has one point of contact.
 */

const BASE = '/api/v1/properties';

export interface PropertyListResult {
  properties: Property[];
  page: PageMeta;
}

export function listProperties(params: PropertyListParams = {}): Promise<PropertyListResult> {
  return apiFetch<PropertyListResult>(`${BASE}${toQueryString({ ...params })}`);
}

export function getProperty(propertyId: string): Promise<Property> {
  return apiFetch<{ property: Property }>(`${BASE}/${propertyId}`).then((res) => res.property);
}

export function createProperty(input: CreatePropertyInput): Promise<Property> {
  return apiFetch<{ property: Property }>(BASE, { method: 'POST', body: input }).then((res) => res.property);
}

export function updateProperty(propertyId: string, input: UpdatePropertyInput): Promise<Property> {
  return apiFetch<{ property: Property }>(`${BASE}/${propertyId}`, { method: 'PATCH', body: input }).then(
    (res) => res.property,
  );
}

/** Cascades to the property's rooms — the UI confirms this explicitly. */
export function deleteProperty(propertyId: string): Promise<void> {
  return apiFetch<void>(`${BASE}/${propertyId}`, { method: 'DELETE' });
}
