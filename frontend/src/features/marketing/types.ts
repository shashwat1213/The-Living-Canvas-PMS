/**
 * Domain types for the AI Marketing Studio, mirroring exactly what
 * `backend/src/modules/marketing` returns.
 */
import type { BadgeTone } from '../../components/Badge';

export const MARKETING_FORMATS = ['SOCIAL_POST', 'EMAIL', 'PROMO_DESCRIPTION', 'TAGLINE'] as const;
export type MarketingFormat = (typeof MARKETING_FORMATS)[number];

export const MARKETING_STATUSES = ['GENERATING', 'DRAFT', 'APPROVED', 'DISCARDED', 'FAILED'] as const;
export type MarketingStatus = (typeof MARKETING_STATUSES)[number];

export const FORMAT_LABEL: Record<MarketingFormat, string> = {
  SOCIAL_POST: 'Social post',
  EMAIL: 'Email',
  PROMO_DESCRIPTION: 'Promo description',
  TAGLINE: 'Tagline',
};

export const STATUS_LABEL: Record<MarketingStatus, string> = {
  GENERATING: 'Generating…',
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  DISCARDED: 'Discarded',
  FAILED: 'Failed',
};

export const STATUS_TONE: Record<MarketingStatus, BadgeTone> = {
  GENERATING: 'info',
  DRAFT: 'warning',
  APPROVED: 'positive',
  DISCARDED: 'muted',
  FAILED: 'danger',
};

export interface UserRef {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** One piece of marketing content exactly as the API serves it. */
export interface MarketingContent {
  id: string;
  propertyId: string;
  format: MarketingFormat;
  status: MarketingStatus;
  tone: string | null;
  brief: string;
  title: string | null;
  generatedBody: string | null;
  editedBody: string | null;
  /** Authoritative body to display: edited if present, else generated. */
  body: string | null;
  isEdited: boolean;
  provider: string | null;
  lastError: string | null;
  createdBy: UserRef | null;
  approvedBy: UserRef | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContentInput {
  format: MarketingFormat;
  brief: string;
  tone?: string;
}

export interface UpdateContentInput {
  title?: string | null;
  editedBody?: string;
}

export interface MarketingListParams {
  search?: string;
  format?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}
