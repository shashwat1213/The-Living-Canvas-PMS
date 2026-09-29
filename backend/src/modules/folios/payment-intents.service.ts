import { BadRequestError, ConflictError, NotFoundError } from '../../lib/http-errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { getPaymentProvider } from '../../platform/payments/registry.js';
import { signStubReturn, stubPaymentId } from '../../platform/payments/stub-provider.js';
import { getRequestContext } from '../../platform/tenancy/context.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { foliosRepository } from './repository.js';
import type { CreatePaymentIntentInput, VerifyPaymentIntentInput } from './schemas.js';

/** The wire shape of a payment intent. */
export interface PaymentIntentView {
  id: string;
  folioId: string;
  amountMinor: number;
  status: 'CREATED' | 'PAID' | 'FAILED';
  provider: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

function toView(row: {
  id: string;
  folioId: string;
  amountMinor: number;
  status: 'CREATED' | 'PAID' | 'FAILED';
  provider: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PaymentIntentView {
  return {
    id: row.id,
    folioId: row.folioId,
    amountMinor: row.amountMinor,
    status: row.status,
    provider: row.provider,
    gatewayOrderId: row.gatewayOrderId,
    gatewayPaymentId: row.gatewayPaymentId,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Open an online payment intent against a folio: place a gateway order for the
 * amount and record a CREATED intent. The client opens the provider's checkout
 * against `gatewayOrderId`; nothing is posted to the folio until the return is
 * verified. The folio must be OPEN — you don't take money onto a settled bill.
 */
export async function createPaymentIntent(
  folioId: string,
  input: CreatePaymentIntentInput,
): Promise<PaymentIntentView> {
  const folio = await foliosRepository.requireById(folioId);
  if (folio.status === 'CLOSED') {
    throw new ConflictError('This folio is closed; reopen it before taking a payment.');
  }

  const provider = getPaymentProvider();
  const { userId } = getRequestContext();

  // Create the intent row first so its id is the gateway receipt/reference.
  const intent = await scopedPrisma.paymentIntent.create({
    data: {
      folioId,
      amountMinor: input.amountMinor,
      provider: provider.key,
      status: 'CREATED',
      createdByUserId: userId,
    },
  });

  try {
    const order = await provider.createOrder({
      amountMinor: input.amountMinor,
      currency: 'INR',
      intentId: intent.id,
    });
    const updated = await scopedPrisma.paymentIntent.update({
      where: { id: intent.id },
      data: { gatewayOrderId: order.gatewayOrderId },
    });
    await recordAuditEvent({
      action: AUDIT_ACTIONS.PAYMENT_INTENT_CREATED,
      entityType: AUDIT_ENTITY_TYPES.PAYMENT_INTENT,
      entityId: intent.id,
      metadata: {
        reference: folio.reservation.reference,
        amountMinor: input.amountMinor,
        provider: provider.key,
      },
    });
    return toView(updated);
  } catch (err) {
    // A gateway that can't even open an order leaves the intent FAILED with the
    // reason, rather than a dangling CREATED row.
    const message = err instanceof Error ? err.message : 'Could not open the payment.';
    const failed = await scopedPrisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: 'FAILED', lastError: message },
    });
    await recordAuditEvent({
      action: AUDIT_ACTIONS.PAYMENT_INTENT_FAILED,
      entityType: AUDIT_ENTITY_TYPES.PAYMENT_INTENT,
      entityId: intent.id,
      metadata: { reference: folio.reservation.reference, error: message },
    });
    void failed;
    throw new BadRequestError(`Could not open the payment: ${message}`);
  }
}

/**
 * Verify a signed gateway return and, on success, post the payment to the
 * folio. This is the security-critical step: the signature is checked
 * server-side by the provider (constant-time HMAC compare), so a client cannot
 * mark an intent paid by posting arbitrary ids. On success, exactly one Payment
 * row (method CARD, linked to the intent) is written in the same transaction
 * that flips the intent to PAID — the unique `paymentIntentId` guarantees the
 * same intent can never post twice. A failed verification leaves the intent
 * FAILED with the reason.
 */
export async function verifyPaymentIntent(
  intentId: string,
  input: VerifyPaymentIntentInput,
): Promise<PaymentIntentView> {
  const intent = await scopedPrisma.paymentIntent.findFirst({
    where: { id: intentId },
    include: { folio: { include: { reservation: { select: { reference: true } } } } },
  });
  if (!intent) {
    throw new NotFoundError('Payment not found.');
  }
  if (intent.status === 'PAID') {
    throw new ConflictError('This payment has already been captured.');
  }
  if (!intent.gatewayOrderId) {
    throw new BadRequestError('This payment was never opened with the gateway.');
  }

  const provider = getPaymentProvider();
  try {
    await provider.verifyPayment({
      intentId: intent.id,
      gatewayOrderId: intent.gatewayOrderId,
      gatewayPaymentId: input.gatewayPaymentId,
      signature: input.signature,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed.';
    await scopedPrisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: 'FAILED', lastError: message, gatewayPaymentId: input.gatewayPaymentId },
    });
    await recordAuditEvent({
      action: AUDIT_ACTIONS.PAYMENT_INTENT_FAILED,
      entityType: AUDIT_ENTITY_TYPES.PAYMENT_INTENT,
      entityId: intent.id,
      metadata: { reference: intent.folio.reservation.reference, error: message },
    });
    throw new BadRequestError(message);
  }

  // Verified: post the payment and flip the intent to PAID atomically.
  const updated = await scopedPrisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        folioId: intent.folioId,
        method: 'CARD',
        amountMinor: intent.amountMinor,
        reference: input.gatewayPaymentId,
        note: `Online payment (${intent.provider})`,
        paymentIntentId: intent.id,
      },
    });
    const paid = await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { status: 'PAID', gatewayPaymentId: input.gatewayPaymentId, lastError: null },
    });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.PAYMENT_INTENT_PAID,
        entityType: AUDIT_ENTITY_TYPES.PAYMENT_INTENT,
        entityId: intent.id,
        metadata: {
          reference: intent.folio.reservation.reference,
          amountMinor: intent.amountMinor,
          provider: intent.provider,
        },
      },
      tx,
    );
    return paid;
  });

  return toView(updated);
}

/** Every payment intent on a folio, newest first — the online-payment history. */
export async function listPaymentIntents(folioId: string): Promise<PaymentIntentView[]> {
  await foliosRepository.requireById(folioId);
  const rows = await scopedPrisma.paymentIntent.findMany({
    where: { folioId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toView);
}

/**
 * DEV/DEMO ONLY: complete an intent as if the gateway checkout succeeded.
 *
 * With no real gateway configured, there is no external checkout to bounce
 * through, so this stands in for the provider's callback: it is allowed ONLY
 * while the stub provider is active (a real Razorpay deployment returns 409 and
 * must go through the actual signed return). It asks the stub to mint a payment
 * id + valid signature and runs the exact same `verifyPaymentIntent` path —
 * proving the whole flow end-to-end without weakening the verification step.
 */
export async function simulatePaymentIntent(intentId: string): Promise<PaymentIntentView> {
  const provider = getPaymentProvider();
  if (provider.key !== 'stub') {
    throw new ConflictError('Simulated payments are only available with the stub gateway (no live credentials).');
  }
  const intent = await scopedPrisma.paymentIntent.findFirst({ where: { id: intentId } });
  if (!intent) {
    throw new NotFoundError('Payment not found.');
  }
  if (!intent.gatewayOrderId) {
    throw new BadRequestError('This payment was never opened with the gateway.');
  }
  const gatewayPaymentId = stubPaymentId();
  const signature = signStubReturn(intent.gatewayOrderId, gatewayPaymentId);
  return verifyPaymentIntent(intentId, { gatewayPaymentId, signature });
}
