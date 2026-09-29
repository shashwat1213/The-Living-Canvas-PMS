/**
 * The payment-gateway seam every online-payment feature is built around.
 *
 * This is the one interface the folio payment flow depends on — the module, the
 * routes and the UI never name a vendor. A real gateway adapter (Razorpay) is a
 * drop-in implementation registered against a provider key; until credentials
 * exist, the deterministic `stub` driver stands in, so the whole create-intent
 * → checkout → verify → post-to-folio flow runs end-to-end in dev, tests and CI
 * with no account and no cost. This mirrors the AI-content and notification
 * seams and matches the "Razorpay, tokenized only" direction in ARCHITECTURE.md:
 * the PMS never stores raw card data, only gateway references.
 */

/** What a provider needs to open a payment: the amount and a stable local
 * reference (the intent id) it can echo back for reconciliation. */
export interface CreateOrderRequest {
  amountMinor: number;
  /** INR only for the initial release, matching the rest of the money model. */
  currency: 'INR';
  /** The local PaymentIntent id — passed as the gateway's receipt/notes so a
   * webhook or return can be tied back without trusting client-supplied ids. */
  intentId: string;
}

/** The gateway's order handle, returned when an intent is opened. `gatewayOrderId`
 * is what the client checkout is opened against; nothing here is a credential. */
export interface CreatedOrder {
  gatewayOrderId: string;
}

/** The signed return a client hands back after paying, to be verified
 * server-side. For Razorpay this is (order id, payment id, signature); the
 * shape is deliberately generic so another vendor's fields map onto it. */
export interface VerifyPaymentRequest {
  intentId: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  /** The provider's signature over the order+payment, verified with the secret
   * key server-side. Never trusted without verification. */
  signature: string;
}

export interface VerifiedPayment {
  gatewayPaymentId: string;
}

/**
 * A payment provider. `createOrder` opens a gateway order for an intent;
 * `verifyPayment` checks a signed return and confirms the money was taken.
 * A provider that can't verify a return MUST throw (the caller marks the intent
 * FAILED and surfaces the reason) — it must never return success it can't prove.
 */
export interface PaymentProvider {
  /** A stable key stored on the intent ("stub", "razorpay"), so an old intent
   * shows what processed it even after the default provider changes. */
  readonly key: string;
  createOrder(request: CreateOrderRequest): Promise<CreatedOrder>;
  verifyPayment(request: VerifyPaymentRequest): Promise<VerifiedPayment>;
}
