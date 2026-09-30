import PDFDocument from 'pdfkit';

import { NotFoundError } from '../../lib/http-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { getReservation } from './service.js';

/**
 * Formats INR paise as a rupee string for the PDF, e.g. 450000 → "INR 4,500.00".
 * Uses the "INR" prefix rather than the ₹ glyph on purpose: pdfkit's built-in
 * Helvetica has no Indian Rupee glyph, so ₹ renders as a stray mark. "INR" is
 * unambiguous, font-safe, and standard on a formal voucher/invoice.
 */
function formatInr(minor: number): string {
  const rupees = minor / 100;
  return `INR ${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A human status label for the voucher. */
const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'In-house',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

/** Brand palette, kept in sync with the app's Mews-style theme (deep green + teal). */
const INK = '#1c1a17';
const GREEN = '#14433a';
const TEAL = '#0f766e';
const MUTED = '#6b7280';
const LINE = '#e5e1da';

/**
 * Render a guest-facing booking voucher / confirmation as a PDF buffer.
 *
 * This is the printable/emailable artifact a guest keeps — the same booking the
 * confirmation email describes, as a document. It reads the reservation through
 * the tenant-scoped service (so a cross-org id 404s exactly as every other
 * read), fetches the property for the letterhead, and lays out a clean
 * single-page voucher. Money and dates come straight from the stored booking;
 * nothing is recomputed here.
 */
export async function renderReservationVoucher(propertyId: string, reservationId: string): Promise<Buffer> {
  // getReservation enforces tenancy + 404s a cross-org/absent booking.
  const reservation = await getReservation(propertyId, reservationId);
  const property = await scopedPrisma.property.findFirst({
    where: { id: propertyId },
    select: { name: true, city: true, region: true, country: true, addressLine1: true },
  });
  if (!property) {
    throw new NotFoundError('Property not found.');
  }

  const guestName = `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim();
  const nights = reservation.nights.length;
  const locationParts = [property.city, property.region, property.country].filter(Boolean);

  const doc = new PDFDocument({ size: 'A4', margin: 56 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;

  // Letterhead ---------------------------------------------------------------
  doc.fillColor(GREEN).fontSize(22).font('Helvetica-Bold').text(property.name, left, 56);
  if (locationParts.length > 0) {
    doc.fillColor(MUTED).fontSize(10).font('Helvetica').text(locationParts.join(', '), { continued: false });
  }
  doc
    .fillColor(TEAL)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text('BOOKING CONFIRMATION', left, 56, { width: contentWidth, align: 'right' });

  // Divider
  let y = 108;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 24;

  // Reference + status band --------------------------------------------------
  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text('CONFIRMATION NUMBER', left, y);
  doc.fillColor(INK).fontSize(16).font('Helvetica-Bold').text(reservation.reference, left, y + 12);

  doc
    .fillColor(MUTED)
    .fontSize(9)
    .font('Helvetica')
    .text('STATUS', left, y, { width: contentWidth, align: 'right' });
  doc
    .fillColor(reservation.status === 'CANCELLED' || reservation.status === 'NO_SHOW' ? '#b42318' : TEAL)
    .fontSize(16)
    .font('Helvetica-Bold')
    .text(STATUS_LABEL[reservation.status] ?? reservation.status, left, y + 12, {
      width: contentWidth,
      align: 'right',
    });

  y += 52;

  // Guest --------------------------------------------------------------------
  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text('GUEST', left, y);
  doc.fillColor(INK).fontSize(13).font('Helvetica-Bold').text(guestName || 'Guest', left, y + 12);
  if (reservation.guest.email) {
    doc.fillColor(MUTED).fontSize(10).font('Helvetica').text(reservation.guest.email, left, y + 30);
  }
  y += 60;

  // Stay details grid --------------------------------------------------------
  const rows: [string, string][] = [
    ['Check-in', reservation.checkIn],
    ['Check-out', reservation.checkOut],
    ['Nights', `${nights} ${nights === 1 ? 'night' : 'nights'}`],
    ['Room type', reservation.roomType.name + (reservation.roomType.code ? ` (${reservation.roomType.code})` : '')],
    ['Room', reservation.room ? reservation.room.name : 'To be assigned at check-in'],
    ['Guests', `${reservation.adults} adult${reservation.adults === 1 ? '' : 's'}${reservation.children > 0 ? `, ${reservation.children} child${reservation.children === 1 ? '' : 'ren'}` : ''}`],
  ];

  doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 16;
  for (const [label, value] of rows) {
    doc.fillColor(MUTED).fontSize(10).font('Helvetica').text(label, left, y, { width: 160 });
    doc.fillColor(INK).fontSize(11).font('Helvetica-Bold').text(value, left + 170, y, { width: contentWidth - 170 });
    y += 24;
  }
  y += 4;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 20;

  // Total --------------------------------------------------------------------
  doc.fillColor(MUTED).fontSize(10).font('Helvetica').text('TOTAL', left, y);
  doc
    .fillColor(GREEN)
    .fontSize(20)
    .font('Helvetica-Bold')
    .text(formatInr(reservation.totalAmountMinor), left, y - 4, { width: contentWidth, align: 'right' });
  y += 36;

  // Footer -------------------------------------------------------------------
  const footerY = doc.page.height - doc.page.margins.bottom - 48;
  doc.moveTo(left, footerY).lineTo(right, footerY).strokeColor(LINE).lineWidth(1).stroke();
  doc
    .fillColor(MUTED)
    .fontSize(9)
    .font('Helvetica')
    .text(
      `Please present this confirmation at check-in. We look forward to welcoming you to ${property.name}.`,
      left,
      footerY + 12,
      { width: contentWidth },
    );

  doc.end();
  return done;
}
