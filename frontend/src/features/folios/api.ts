import { apiFetch } from '../../lib/api';
import type { AddChargeInput, AddPaymentInput, Folio, PaymentIntent } from './types';

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

/** Open an online payment intent for an amount owed. Returns the CREATED intent
 * (with the gateway order id) — the client opens the provider's checkout next. */
export function createPaymentIntent(
  propertyId: string,
  reservationId: string,
  amountMinor: number,
): Promise<PaymentIntent> {
  return apiFetch<{ intent: PaymentIntent }>(`${base(propertyId, reservationId)}/payment-intents`, {
    method: 'POST',
    body: { amountMinor },
  }).then((res) => res.intent);
}

/**
 * Complete an intent as if the gateway checkout succeeded. Backed by the
 * dev/demo `simulate` route (stub gateway only) — with live Razorpay this is
 * replaced by the SDK's signed return posted to `/verify`. Kept as the single
 * "the payment went through" call the dialog makes so swapping providers is a
 * frontend-local change.
 */
export function completePaymentIntent(
  propertyId: string,
  reservationId: string,
  intentId: string,
): Promise<PaymentIntent> {
  return apiFetch<{ intent: PaymentIntent }>(
    `${base(propertyId, reservationId)}/payment-intents/${intentId}/simulate`,
    { method: 'POST' },
  ).then((res) => res.intent);
}
