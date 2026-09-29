import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type { CreateContentInput, MarketingContent, MarketingListParams, UpdateContentInput } from './types';

/**
 * The only place the marketing endpoints are named. All calls are
 * property-scoped and go through `lib/api` (never raw fetch, never a
 * hardcoded origin). `apiFetch` serializes the body itself.
 */
function base(propertyId: string): string {
  return `/api/v1/properties/${propertyId}/marketing/content`;
}

export interface MarketingListResult {
  content: MarketingContent[];
  page: PageMeta;
}

export function listContent(propertyId: string, params: MarketingListParams = {}): Promise<MarketingListResult> {
  return apiFetch<MarketingListResult>(`${base(propertyId)}${toQueryString({ ...params })}`);
}

export function getContent(propertyId: string, id: string): Promise<{ content: MarketingContent }> {
  return apiFetch<{ content: MarketingContent }>(`${base(propertyId)}/${id}`);
}

export function createContent(propertyId: string, input: CreateContentInput): Promise<{ content: MarketingContent }> {
  return apiFetch<{ content: MarketingContent }>(base(propertyId), { method: 'POST', body: input });
}

export function updateContent(
  propertyId: string,
  id: string,
  input: UpdateContentInput,
): Promise<{ content: MarketingContent }> {
  return apiFetch<{ content: MarketingContent }>(`${base(propertyId)}/${id}`, { method: 'PATCH', body: input });
}

export function regenerateContent(propertyId: string, id: string): Promise<{ content: MarketingContent }> {
  return apiFetch<{ content: MarketingContent }>(`${base(propertyId)}/${id}/regenerate`, { method: 'POST' });
}

export function discardContent(propertyId: string, id: string): Promise<{ content: MarketingContent }> {
  return apiFetch<{ content: MarketingContent }>(`${base(propertyId)}/${id}/discard`, { method: 'POST' });
}

export function approveContent(propertyId: string, id: string): Promise<{ content: MarketingContent }> {
  return apiFetch<{ content: MarketingContent }>(`${base(propertyId)}/${id}/approve`, { method: 'POST' });
}
