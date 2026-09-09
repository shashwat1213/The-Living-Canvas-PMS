/**
 * Notification content templates. Each returns the composed subject/body a
 * notification is stored with — rendered once, at the triggering event, and
 * persisted (see the Notification model doc). Kept as plain functions rather
 * than a template engine: the set is small and the composition is trivial,
 * and a real templating/localization layer is a later concern that slots in
 * behind this same seam without changing any caller.
 */

export interface ComposedMessage {
  subject: string;
  body: string;
}

export interface ReservationConfirmationData {
  guestName: string;
  propertyName: string;
  reference: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  nights: number;
  totalAmountMinor: number; // INR paise
}

/** Formats INR paise as a rupee string, e.g. 450000 → "₹4,500.00". */
function formatInr(minor: number): string {
  const rupees = minor / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function reservationConfirmationMessage(data: ReservationConfirmationData): ComposedMessage {
  const nightLabel = data.nights === 1 ? 'night' : 'nights';
  return {
    subject: `Booking confirmed — ${data.propertyName} (${data.reference})`,
    body:
      `Hi ${data.guestName},\n\n` +
      `Your booking at ${data.propertyName} is confirmed.\n\n` +
      `Confirmation: ${data.reference}\n` +
      `Check-in:  ${data.checkIn}\n` +
      `Check-out: ${data.checkOut}\n` +
      `Stay: ${data.nights} ${nightLabel}\n` +
      `Total: ${formatInr(data.totalAmountMinor)}\n\n` +
      `We look forward to welcoming you.\n${data.propertyName}`,
  };
}
