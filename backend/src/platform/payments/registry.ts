import type { PaymentProvider } from './provider.js';
import { stubPaymentProvider } from './stub-provider.js';

/**
 * The active payment provider. Defaults to the deterministic stub; the real
 * Razorpay adapter replaces it with one call at startup
 * (`setPaymentProvider(razorpayProvider)`) once `RAZORPAY_KEY_ID` /
 * `RAZORPAY_KEY_SECRET` are configured, and everything downstream — the intent
 * flow, the stored `provider` key, the folio — picks it up with no other
 * change. One swappable instance, like the AI-content seam: the seam is the
 * interface, not a routing table.
 */
let active: PaymentProvider = stubPaymentProvider;

export function setPaymentProvider(provider: PaymentProvider): void {
  active = provider;
}

export function getPaymentProvider(): PaymentProvider {
  return active;
}

/** Test-only: restore the stub default so a suite starts from a known state. */
export function resetPaymentProvider(): void {
  active = stubPaymentProvider;
}
