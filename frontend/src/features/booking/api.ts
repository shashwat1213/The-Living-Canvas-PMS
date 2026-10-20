import { API_URL } from '../../lib/api';

/**
 * The public booking engine's client. Deliberately NOT routed through
 * `lib/api` (which attaches the staff auth token and does a silent refresh on
 * 401) — this is the anonymous guest surface, so it uses a plain fetch with no
 * credentials. Errors surface as a typed BookingApiError the page can render.
 */

export interface PublicProperty {
  slug: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

export interface BookableOption {
  roomTypeId: string;
  roomTypeName: string;
  description: string | null;
  ratePlanId: string;
  ratePlanName: string;
  nights: number;
  totalMinor: number;
  avgNightlyMinor: number;
  roomsLeft: number;
}

export interface SearchResult {
  property: PublicProperty;
  checkIn: string;
  checkOut: string;
  options: BookableOption[];
}

export interface BookingConfirmation {
  reference: string;
  propertyName: string;
  roomTypeName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalMinor: number;
  guestName: string;
}

export interface GuestDetails {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

export class BookingApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'BookingApiError';
    this.status = status;
  }
}

async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/book${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new BookingApiError(0, 'Could not reach the server. Please try again.');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // keep the generic message
    }
    throw new BookingApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export function getProperty(slug: string): Promise<{ property: PublicProperty }> {
  return publicFetch(`/${encodeURIComponent(slug)}`);
}

export function search(
  slug: string,
  params: { checkIn: string; checkOut: string; adults?: number; children?: number },
): Promise<SearchResult> {
  const qs = new URLSearchParams({ checkIn: params.checkIn, checkOut: params.checkOut });
  if (params.adults) qs.set('adults', String(params.adults));
  if (params.children) qs.set('children', String(params.children));
  return publicFetch(`/${encodeURIComponent(slug)}/search?${qs.toString()}`);
}

export function book(
  slug: string,
  input: {
    roomTypeId: string;
    ratePlanId: string;
    checkIn: string;
    checkOut: string;
    adults?: number;
    children?: number;
    guest: GuestDetails;
    notes?: string;
  },
): Promise<{ confirmation: BookingConfirmation }> {
  return publicFetch(`/${encodeURIComponent(slug)}/book`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Format integer paise as INR. */
export function formatMoney(minor: number): string {
  return `₹${(minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
