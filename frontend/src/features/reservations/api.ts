import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type {
  AssignableRoom,
  CreateReservationInput,
  Reservation,
  ReservationListParams,
  ReservationListRow,
  ReservationQuote,
} from './types';

/**
 * The only place reservation endpoints are named. Reservations live under a
 * property, so every call carries the property id — the backend resolves it
 * through the tenant-scoped client, which is what makes a cross-organization
 * property (or reservation) a 404 rather than a leak.
 */
const base = (propertyId: string) => `/api/v1/properties/${propertyId}/reservations`;

export interface ReservationListResult {
  reservations: ReservationListRow[];
  page: PageMeta;
}

export function listReservations(
  propertyId: string,
  params: ReservationListParams = {},
): Promise<ReservationListResult> {
  return apiFetch<ReservationListResult>(`${base(propertyId)}${toQueryString({ ...params })}`);
}

export function getReservation(propertyId: string, reservationId: string): Promise<Reservation> {
  return apiFetch<{ reservation: Reservation }>(`${base(propertyId)}/${reservationId}`).then((res) => res.reservation);
}

/**
 * A pre-booking quote — availability and price for a proposed stay, writing
 * nothing. Only needs `reservations:read`, so a front-desk agent can price a
 * stay before committing.
 */
export function quoteReservation(propertyId: string, input: CreateReservationInput): Promise<ReservationQuote> {
  return apiFetch<ReservationQuote>(`${base(propertyId)}/quote`, { method: 'POST', body: input });
}

export function createReservation(propertyId: string, input: CreateReservationInput): Promise<Reservation> {
  return apiFetch<{ reservation: Reservation }>(base(propertyId), { method: 'POST', body: input }).then(
    (res) => res.reservation,
  );
}

export function cancelReservation(propertyId: string, reservationId: string, reason?: string): Promise<Reservation> {
  return apiFetch<{ reservation: Reservation }>(`${base(propertyId)}/${reservationId}/cancel`, {
    method: 'POST',
    body: reason ? { reason } : {},
  }).then((res) => res.reservation);
}

export function markNoShow(propertyId: string, reservationId: string): Promise<Reservation> {
  return apiFetch<{ reservation: Reservation }>(`${base(propertyId)}/${reservationId}/no-show`, {
    method: 'POST',
  }).then((res) => res.reservation);
}

export function listAssignableRooms(propertyId: string, reservationId: string): Promise<AssignableRoom[]> {
  return apiFetch<{ rooms: AssignableRoom[] }>(`${base(propertyId)}/${reservationId}/assignable-rooms`).then(
    (res) => res.rooms,
  );
}

export function assignRoom(propertyId: string, reservationId: string, roomId: string): Promise<Reservation> {
  return apiFetch<{ reservation: Reservation }>(`${base(propertyId)}/${reservationId}/assign-room`, {
    method: 'POST',
    body: { roomId },
  }).then((res) => res.reservation);
}

export function checkIn(propertyId: string, reservationId: string, roomId?: string): Promise<Reservation> {
  return apiFetch<{ reservation: Reservation }>(`${base(propertyId)}/${reservationId}/check-in`, {
    method: 'POST',
    body: roomId ? { roomId } : {},
  }).then((res) => res.reservation);
}

export function checkOut(propertyId: string, reservationId: string): Promise<Reservation> {
  return apiFetch<{ reservation: Reservation }>(`${base(propertyId)}/${reservationId}/check-out`, {
    method: 'POST',
  }).then((res) => res.reservation);
}
