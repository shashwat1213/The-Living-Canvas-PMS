/**
 * INR money helpers. The API stores and returns money as integer **minor
 * units (paise)** — never a float — so all arithmetic here stays in paise
 * and formatting happens only at the edge.
 */

/** Formats paise as "₹4,500.00". */
export function formatMinor(amountMinor: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

/** Compact "₹4,500" (no paise) for dense calendar cells. */
export function formatMinorCompact(amountMinor: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

/**
 * Parses a rupee string ("4500", "4,500.50") into integer paise. Returns
 * `null` for anything that isn't a non-negative amount with at most two
 * decimal places — the caller shows a field error rather than sending it.
 */
export function parseRupeesToMinor(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '').trim();
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

/** Renders paise as an editable rupee string ("4500" or "4500.50"). */
export function minorToRupeesInput(amountMinor: number): string {
  const rupees = amountMinor / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}
