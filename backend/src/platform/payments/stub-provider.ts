import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type {
  CreatedOrder,
  CreateOrderRequest,
  PaymentProvider,
  VerifiedPayment,
  VerifyPaymentRequest,
} from './provider.js';

/**
 * A deterministic, self-contained payment provider for dev / tests / CI — no
 * account, no network, no cost. It stands in for a real gateway so the whole
 * online-payment flow (open intent → checkout → verify → post to folio) runs
 * end-to-end, exactly as the AI-content stub does for the Marketing Studio.
 *
 * It is not a no-op: it models the real security property that matters —
 * server-side signature verification. `createOrder` returns an order id;
 * `signOrder` (used by the test/dev checkout) produces the HMAC the real client
 * would send back; `verifyPayment` recomputes that HMAC with a constant-time
 * compare and rejects a bad signature, just like Razorpay's
 * `validateWebhookSignature`. Swapping in the Razorpay adapter changes only the
 * transport, not this contract.
 */
const STUB_SECRET = 'stub-gateway-secret-not-a-real-credential';

function sign(orderId: string, paymentId: string): string {
  return createHmac('sha256', STUB_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
}

/** The signature a well-behaved client return carries — used by tests and the
 * dev checkout to simulate a successful payment. Exposed only from the stub. */
export function signStubReturn(gatewayOrderId: string, gatewayPaymentId: string): string {
  return sign(gatewayOrderId, gatewayPaymentId);
}

export const stubPaymentProvider: PaymentProvider = {
  key: 'stub',

  async createOrder(request: CreateOrderRequest): Promise<CreatedOrder> {
    // A stable, unique order id derived from the intent — mirrors a gateway
    // returning an order handle for a receipt.
    return { gatewayOrderId: `stub_order_${request.intentId}` };
  },

  async verifyPayment(request: VerifyPaymentRequest): Promise<VerifiedPayment> {
    const expected = sign(request.gatewayOrderId, request.gatewayPaymentId);
    const a = Buffer.from(expected);
    const b = Buffer.from(request.signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Payment signature verification failed.');
    }
    return { gatewayPaymentId: request.gatewayPaymentId };
  },
};

/** A helper the dev/test checkout uses to mint a plausible gateway payment id. */
export function stubPaymentId(): string {
  return `stub_pay_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
