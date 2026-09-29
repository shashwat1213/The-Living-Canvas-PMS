import { useEffect, useState } from 'react';

import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { formatMinor, parseRupeesToMinor } from '../rate-plans/money';
import {
  addCharge,
  addPayment,
  closeFolio,
  completePaymentIntent,
  createPaymentIntent,
  getFolio,
  reopenFolio,
} from './api';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Folio, type PaymentMethod } from './types';
import './folios.css';

interface FolioDialogProps {
  propertyId: string;
  reservationId: string;
  reference: string;
  /** Whether the user may post charges/payments and open/close (payments:manage). */
  mayManage: boolean;
  onClose: () => void;
}

/**
 * The guest bill for a reservation. Opens (and posts the room charge) on first
 * view via the GET. Shows charges and payments with a derived balance, and —
 * for a user with `payments:manage` — lets the front desk post an extra
 * charge, record a payment, and settle/close the folio. All money is INR;
 * amounts are entered in rupees and converted to paise at the edge.
 */
export function FolioDialog({ propertyId, reservationId, reference, mayManage, onClose }: FolioDialogProps) {
  const [folio, setFolio] = useState<Folio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Charge form.
  const [chargeDesc, setChargeDesc] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  // Payment form.
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');
  const [payAmount, setPayAmount] = useState('');
  const [payReference, setPayReference] = useState('');

  useEffect(() => {
    let active = true;
    getFolio(propertyId, reservationId)
      .then((f) => {
        if (active) setFolio(f);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load this folio.');
      });
    return () => {
      active = false;
    };
  }, [propertyId, reservationId]);

  async function run(action: () => Promise<Folio>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      setFolio(updated);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete that action.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAddCharge() {
    const amountMinor = parseRupeesToMinor(chargeAmount);
    if (!chargeDesc.trim()) {
      setError('Enter a description for the charge.');
      return;
    }
    if (amountMinor === null || amountMinor === 0) {
      setError('Enter a valid charge amount in rupees.');
      return;
    }
    const ok = await run(() => addCharge(propertyId, reservationId, { description: chargeDesc.trim(), amountMinor }));
    if (ok) {
      setChargeDesc('');
      setChargeAmount('');
    }
  }

  async function handleAddPayment() {
    const amountMinor = parseRupeesToMinor(payAmount);
    if (amountMinor === null || amountMinor === 0) {
      setError('Enter a valid payment amount in rupees.');
      return;
    }
    const ok = await run(() =>
      addPayment(propertyId, reservationId, {
        method: payMethod,
        amountMinor,
        reference: payReference.trim() || undefined,
      }),
    );
    if (ok) {
      setPayAmount('');
      setPayReference('');
    }
  }

  const balance = folio?.balanceMinor ?? 0;
  const settled = balance === 0;

  /**
   * Take the outstanding balance online through the payment-gateway seam:
   * open an intent, then complete it. In dev/CI the stub gateway drives the
   * flow (the `simulate` route); with live Razorpay the completion is the
   * SDK's signed return. Either way the folio gets a real CARD payment.
   */
  async function handlePayOnline() {
    if (balance <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await createPaymentIntent(propertyId, reservationId, balance);
      await completePaymentIntent(propertyId, reservationId, intent.id);
      const updated = await getFolio(propertyId, reservationId);
      setFolio(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The online payment could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Folio — ${reference}`}
      description={folio ? `${folio.reservation.guest.firstName} ${folio.reservation.guest.lastName}` : undefined}
      size="wide"
      onClose={onClose}
    >
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!folio && !error && <p className="folio-loading">Loading folio…</p>}

      {folio && (
        <div className="folio">
          <div className="folio-status-row">
            <Badge tone={folio.status === 'OPEN' ? 'accent' : 'muted'}>
              {folio.status === 'OPEN' ? 'Open' : 'Closed'}
            </Badge>
            {mayManage &&
              (folio.status === 'OPEN' ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy || !settled}
                  title={settled ? undefined : 'Settle the balance to zero before closing.'}
                  onClick={() => void run(() => closeFolio(propertyId, reservationId))}
                >
                  Close folio
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void run(() => reopenFolio(propertyId, reservationId))}
                >
                  Reopen folio
                </button>
              ))}
          </div>

          {/* Charges */}
          <section className="folio-section">
            <h3>Charges</h3>
            <table className="folio-table">
              <tbody>
                {folio.charges.map((c) => (
                  <tr key={c.id}>
                    <td>{c.description}</td>
                    <td className="folio-amount">{formatMinor(c.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total charges</th>
                  <td className="folio-amount">{formatMinor(folio.chargesTotalMinor)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          {/* Payments */}
          <section className="folio-section">
            <h3>Payments</h3>
            {folio.payments.length === 0 ? (
              <p className="folio-empty">No payments recorded yet.</p>
            ) : (
              <table className="folio-table">
                <tbody>
                  {folio.payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {PAYMENT_METHOD_LABEL[p.method]}
                        {p.reference && <span className="folio-muted"> · {p.reference}</span>}
                      </td>
                      <td className="folio-amount">{formatMinor(p.amountMinor)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total paid</th>
                    <td className="folio-amount">{formatMinor(folio.paymentsTotalMinor)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </section>

          {/* Balance */}
          <div className={`folio-balance ${settled ? 'folio-settled' : balance > 0 ? 'folio-owing' : 'folio-credit'}`}>
            <span>{balance > 0 ? 'Balance due' : balance < 0 ? 'Refund due' : 'Settled'}</span>
            <span className="folio-balance-amount">{formatMinor(Math.abs(balance))}</span>
          </div>

          {/* Posting forms — manage only, and only while open */}
          {mayManage && folio.status === 'OPEN' && (
            <div className="folio-forms">
              <div className="folio-form">
                <h4>Add charge</h4>
                <div className="folio-form-row">
                  <input
                    type="text"
                    placeholder="Description (e.g. Minibar)"
                    value={chargeDesc}
                    onChange={(e) => setChargeDesc(e.target.value)}
                    disabled={busy}
                    aria-label="Charge description"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="₹ amount"
                    value={chargeAmount}
                    onChange={(e) => setChargeAmount(e.target.value)}
                    disabled={busy}
                    aria-label="Charge amount in rupees"
                  />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void handleAddCharge()}>
                    Add
                  </button>
                </div>
              </div>

              <div className="folio-form">
                <h4>Record payment</h4>
                <div className="folio-form-row">
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    disabled={busy}
                    aria-label="Payment method"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="₹ amount"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    disabled={busy}
                    aria-label="Payment amount in rupees"
                  />
                  <input
                    type="text"
                    placeholder="Reference (optional)"
                    value={payReference}
                    onChange={(e) => setPayReference(e.target.value)}
                    disabled={busy}
                    aria-label="Payment reference"
                  />
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void handleAddPayment()}>
                    Record
                  </button>
                </div>
              </div>

              {/* Online payment through the gateway seam — one click settles the
                  outstanding balance as a CARD payment. */}
              {balance > 0 && (
                <div className="folio-form folio-pay-online">
                  <h4>Pay online</h4>
                  <div className="folio-form-row">
                    <p className="folio-pay-online-hint">
                      Charge the balance of {formatMinor(balance)} to the guest&apos;s card via the payment gateway.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => void handlePayOnline()}
                    >
                      {busy ? 'Processing…' : `Pay ${formatMinor(balance)} online`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
