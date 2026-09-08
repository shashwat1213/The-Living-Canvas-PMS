import { apiFetch } from '../../lib/api';
import type { AddChargeInput, AddPaymentInput, Folio } from './types';

/**
 * The only place folio endpoints are named. A folio lives under a reservation,
 * which lives under a property, so every call carries both ids — the backend
 * resolves that chain through the tenant-scoped client, which is what makes a
 * cross-organization id a 404. The GET opens the folio (posting the room
 * charge) on first access.
 */
const base = (propertyId: string, reservationId: string) =>
  `/api/v1/properties/${propertyId}/reservations/${reservationId}/folio`;

export function getFolio(propertyId: string, reservationId: string): Promise<Folio> {
  return apiFetch<{ folio: Folio }>(base(propertyId, reservationId)).then((res) => res.folio);
}

export function addCharge(propertyId: string, reservationId: string, input: AddChargeInput): Promise<Folio> {
  return apiFetch<{ folio: Folio }>(`${base(propertyId, reservationId)}/charges`, {
    method: 'POST',
    body: input,
  }).then((res) => res.folio);
}

export function addPayment(propertyId: string, reservationId: string, input: AddPaymentInput): Promise<Folio> {
  return apiFetch<{ folio: Folio }>(`${base(propertyId, reservationId)}/payments`, {
    method: 'POST',
    body: input,
  }).then((res) => res.folio);
}

export function closeFolio(propertyId: string, reservationId: string): Promise<Folio> {
  return apiFetch<{ folio: Folio }>(`${base(propertyId, reservationId)}/close`, { method: 'POST' }).then(
    (res) => res.folio,
  );
}

export function reopenFolio(propertyId: string, reservationId: string): Promise<Folio> {
  return apiFetch<{ folio: Folio }>(`${base(propertyId, reservationId)}/reopen`, { method: 'POST' }).then(
    (res) => res.folio,
  );
}
