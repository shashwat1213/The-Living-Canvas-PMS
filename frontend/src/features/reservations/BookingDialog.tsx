import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { listGuests } from '../guests/api';
import type { Guest } from '../guests/types';
import { guestFullName } from '../guests/types';
import { formatMinor } from '../rate-plans/money';
import { listRatePlans } from '../rate-plans/api';
import type { RatePlan } from '../rate-plans/types';
import { listRoomTypes } from '../room-types/api';
import type { RoomType } from '../room-types/types';
import { createReservation, quoteReservation } from './api';
import type { CreateReservationInput, Reservation, ReservationQuote } from './types';
import { nightCount } from './types';

interface BookingDialogProps {
  propertyId: string;
  onClose: () => void;
  onBooked: (reservation: Reservation) => void;
}

interface FormState {
  guestId: string;
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  adults: string;
  children: string;
  notes: string;
}

const EMPTY: FormState = {
  guestId: '',
  roomTypeId: '',
  ratePlanId: '',
  checkIn: '',
  checkOut: '',
  adults: '1',
  children: '0',
  notes: '',
};

/** Today as `YYYY-MM-DD`, for a sensible min on the date inputs. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toPayload(form: FormState): CreateReservationInput {
  return {
    guestId: form.guestId,
    roomTypeId: form.roomTypeId,
    ratePlanId: form.ratePlanId,
    checkIn: form.checkIn,
    checkOut: form.checkOut,
    adults: Number(form.adults) || 1,
    children: Number(form.children) || 0,
    notes: form.notes.trim() === '' ? undefined : form.notes.trim(),
  };
}

/**
 * Create a booking. The whole booking core in one place: pick a guest, a room
 * type and a rate plan, choose the stay dates, see live availability and price
 * from the server's own quote, and confirm. The client never computes money —
 * `POST /quote` and `POST /` both price on the server.
 */
export function BookingDialog({ propertyId, onClose, onBooked }: BookingDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [guests, setGuests] = useState<Guest[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);

  const [quote, setQuote] = useState<ReservationQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Load the pickers once. Guests are org-scoped; room types are the active
  // catalogue for this property (you can't book a retired type). A picker
  // that fails to load leaves an explanatory empty option rather than taking
  // the whole dialog down.
  useEffect(() => {
    listGuests({ pageSize: 100 })
      .then((res) => setGuests(res.guests))
      .catch(() => setGuests([]));
    listRoomTypes(propertyId, { status: 'ACTIVE', pageSize: 100 })
      .then((res) => setRoomTypes(res.roomTypes))
      .catch(() => setRoomTypes([]));
  }, [propertyId]);

  // When the room type changes, load its active rate plans and clear any plan
  // already chosen for the previous type — a plan belongs to exactly one type.
  useEffect(() => {
    if (!form.roomTypeId) {
      setRatePlans([]);
      return;
    }
    setLoadingPlans(true);
    listRatePlans(propertyId, form.roomTypeId, { status: 'ACTIVE', pageSize: 100 })
      .then((res) => setRatePlans(res.ratePlans))
      .catch(() => setRatePlans([]))
      .finally(() => setLoadingPlans(false));
  }, [propertyId, form.roomTypeId]);

  const nights = useMemo(
    () => (form.checkIn && form.checkOut ? nightCount(form.checkIn, form.checkOut) : 0),
    [form.checkIn, form.checkOut],
  );

  const readyToQuote =
    form.guestId !== '' &&
    form.roomTypeId !== '' &&
    form.ratePlanId !== '' &&
    form.checkIn !== '' &&
    form.checkOut !== '' &&
    nights > 0;

  // Ask the server for a live quote whenever the priced inputs settle. Debounced
  // so dragging a date picker doesn't fire a request per intermediate value.
  // The guest isn't part of the price, so it's deliberately not a dependency.
  useEffect(() => {
    if (!readyToQuote) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    setQuoting(true);
    const timer = setTimeout(() => {
      quoteReservation(propertyId, {
        // A guest is required by the schema even for a quote; a placeholder is
        // fine because quoting writes nothing and never resolves the guest for
        // pricing. If none is picked yet, skip until one is — see the guard.
        guestId: form.guestId,
        roomTypeId: form.roomTypeId,
        ratePlanId: form.ratePlanId,
        checkIn: form.checkIn,
        checkOut: form.checkOut,
      })
        .then((result) => {
          setQuote(result);
          setQuoteError(null);
        })
        .catch((err) => {
          setQuote(null);
          setQuoteError(err instanceof ApiError ? err.message : 'Could not price this stay.');
        })
        .finally(() => setQuoting(false));
    }, 350);
    return () => clearTimeout(timer);
    // form.guestId is included because the quote endpoint requires a guest id;
    // once one is chosen the quote can run. Re-quoting on guest change is cheap.
  }, [propertyId, readyToQuote, form.guestId, form.roomTypeId, form.ratePlanId, form.checkIn, form.checkOut]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      // Changing the room type invalidates the chosen rate plan.
      if (key === 'roomTypeId') next.ratePlanId = '';
      return next;
    });
    setFieldErrors((current) => ({ ...current, [key]: '' }));
  }

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!form.guestId) errors.guestId = 'Choose a guest.';
    if (!form.roomTypeId) errors.roomTypeId = 'Choose a room type.';
    if (!form.ratePlanId) errors.ratePlanId = 'Choose a rate plan.';
    if (!form.checkIn) errors.checkIn = 'Pick an arrival date.';
    if (!form.checkOut) errors.checkOut = 'Pick a departure date.';
    else if (nights <= 0) errors.checkOut = 'Departure must be after arrival.';
    return errors;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    try {
      const reservation = await createReservation(propertyId, toPayload(form));
      onBooked(reservation);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.issues?.length) {
          const mapped: Record<string, string> = {};
          for (const issue of err.issues) {
            const key = issue.path.split('.')[0];
            if (key) mapped[key] = issue.message;
          }
          setFieldErrors(mapped);
        }
      } else {
        setError('Could not create this booking.');
      }
    } finally {
      setSaving(false);
    }
  }

  const noGuests = guests.length === 0;
  const noRoomTypes = roomTypes.length === 0;
  // Block confirming when the server says there's no room left, so the only
  // outcome of the click would be a 409. The price still shows.
  const soldOut = quote !== null && !quote.available;
  const confirmDisabled = saving || !readyToQuote || !form.guestId || soldOut || quoting;

  return (
    <Modal
      title="New booking"
      description="Check availability and price a stay, then confirm."
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="booking-form" className="btn btn-primary" disabled={confirmDisabled}>
            {saving ? 'Booking…' : 'Confirm booking'}
          </button>
        </>
      }
    >
      <form id="booking-form" className="booking-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}

        {noRoomTypes && (
          <p className="booking-notice">
            This property has no active room types. Set up the catalogue and its rate plans before taking a booking.
          </p>
        )}

        <div className="field">
          <label htmlFor="booking-guest">Guest</label>
          <select
            id="booking-guest"
            value={form.guestId}
            onChange={(event) => update('guestId', event.target.value)}
            disabled={saving || noGuests}
            aria-invalid={Boolean(fieldErrors.guestId)}
          >
            <option value="">{noGuests ? 'No guests yet — add one first' : 'Select a guest…'}</option>
            {guests.map((guest) => (
              <option key={guest.id} value={guest.id}>
                {guestFullName(guest)}
                {guest.email ? ` · ${guest.email}` : ''}
              </option>
            ))}
          </select>
          {fieldErrors.guestId && <span className="field-error">{fieldErrors.guestId}</span>}
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="booking-room-type">Room type</label>
            <select
              id="booking-room-type"
              value={form.roomTypeId}
              onChange={(event) => update('roomTypeId', event.target.value)}
              disabled={saving || noRoomTypes}
              aria-invalid={Boolean(fieldErrors.roomTypeId)}
            >
              <option value="">Select a room type…</option>
              {roomTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                  {type.code ? ` (${type.code})` : ''}
                </option>
              ))}
            </select>
            {fieldErrors.roomTypeId && <span className="field-error">{fieldErrors.roomTypeId}</span>}
          </div>

          <div className="field">
            <label htmlFor="booking-rate-plan">Rate plan</label>
            <select
              id="booking-rate-plan"
              value={form.ratePlanId}
              onChange={(event) => update('ratePlanId', event.target.value)}
              disabled={saving || !form.roomTypeId || loadingPlans}
              aria-invalid={Boolean(fieldErrors.ratePlanId)}
            >
              <option value="">
                {!form.roomTypeId
                  ? 'Choose a room type first'
                  : loadingPlans
                    ? 'Loading…'
                    : ratePlans.length === 0
                      ? 'No active rate plans'
                      : 'Select a rate plan…'}
              </option>
              {ratePlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                  {plan.isRefundable ? '' : ' · Non-refundable'}
                </option>
              ))}
            </select>
            {fieldErrors.ratePlanId && <span className="field-error">{fieldErrors.ratePlanId}</span>}
          </div>
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="booking-check-in">Arrival</label>
            <input
              id="booking-check-in"
              type="date"
              min={todayIso()}
              value={form.checkIn}
              onChange={(event) => update('checkIn', event.target.value)}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.checkIn)}
            />
            {fieldErrors.checkIn && <span className="field-error">{fieldErrors.checkIn}</span>}
          </div>
          <div className="field">
            <label htmlFor="booking-check-out">Departure</label>
            <input
              id="booking-check-out"
              type="date"
              min={form.checkIn || todayIso()}
              value={form.checkOut}
              onChange={(event) => update('checkOut', event.target.value)}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.checkOut)}
              aria-describedby="booking-nights-hint"
            />
            {fieldErrors.checkOut ? (
              <span className="field-error">{fieldErrors.checkOut}</span>
            ) : (
              <span id="booking-nights-hint" className="field-hint">
                {nights > 0 ? `${nights} night${nights === 1 ? '' : 's'}` : 'Departure is the morning you leave.'}
              </span>
            )}
          </div>
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="booking-adults">Adults</label>
            <input
              id="booking-adults"
              type="number"
              min={1}
              max={30}
              value={form.adults}
              onChange={(event) => update('adults', event.target.value)}
              disabled={saving}
            />
          </div>
          <div className="field">
            <label htmlFor="booking-children">Children</label>
            <input
              id="booking-children"
              type="number"
              min={0}
              max={30}
              value={form.children}
              onChange={(event) => update('children', event.target.value)}
              disabled={saving}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="booking-notes">Notes</label>
          <textarea
            id="booking-notes"
            rows={2}
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
            disabled={saving}
            placeholder="Late arrival, accessibility needs, preferences…"
          />
        </div>

        {/* Live availability + price panel, driven entirely by the server's
            quote. It never invents a number — an unpriced night surfaces the
            server's own error rather than a silent zero. */}
        {readyToQuote && (
          <div className="booking-quote" aria-live="polite">
            {quoting && <p className="booking-quote-status">Checking availability…</p>}
            {!quoting && quoteError && <p className="booking-quote-error">{quoteError}</p>}
            {!quoting && !quoteError && quote && (
              <>
                <div className="booking-quote-row">
                  <span>Availability</span>
                  <span className={quote.available ? 'booking-ok' : 'booking-bad'}>
                    {quote.available
                      ? `${quote.sellableRooms - quote.booked} of ${quote.sellableRooms} room${quote.sellableRooms === 1 ? '' : 's'} free`
                      : 'Sold out for these dates'}
                  </span>
                </div>
                <div className="booking-quote-row">
                  <span>
                    {quote.nights} night{quote.nights === 1 ? '' : 's'}
                  </span>
                  <span className="booking-total">{formatMinor(quote.totalMinor)}</span>
                </div>
              </>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
