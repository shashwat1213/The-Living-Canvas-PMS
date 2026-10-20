import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import {
  book,
  BookingApiError,
  formatMoney,
  getProperty,
  search,
  type BookableOption,
  type BookingConfirmation,
  type GuestDetails,
  type PublicProperty,
} from './api';
import './booking.css';

/** Today + N days as YYYY-MM-DD (UTC, matching the stay-date convention). */
function isoPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function locationLine(p: PublicProperty): string {
  return [p.addressLine1, p.city, p.region, p.country].filter(Boolean).join(', ');
}

/**
 * The public, guest-facing booking site for one property, addressed by its
 * slug: /book/:slug. No login. Search a date window → pick a room → enter guest
 * details → confirmation. Talks only to the public /api/v1/book endpoints.
 */
export function BookingPage() {
  const { slug = '' } = useParams<{ slug: string }>();

  const [property, setProperty] = useState<PublicProperty | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [checkIn, setCheckIn] = useState(isoPlus(7));
  const [checkOut, setCheckOut] = useState(isoPlus(9));
  const [adults, setAdults] = useState(2);

  const [options, setOptions] = useState<BookableOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<BookableOption | null>(null);
  const [guest, setGuest] = useState<GuestDetails>({ firstName: '', lastName: '', email: '' });
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);

  useEffect(() => {
    getProperty(slug)
      .then((res) => setProperty(res.property))
      .catch((err) => setLoadError(err instanceof BookingApiError ? err.message : 'Could not load this property.'));
  }, [slug]);

  async function runSearch(event?: FormEvent) {
    event?.preventDefault();
    setSearching(true);
    setSearchError(null);
    setOptions(null);
    setSelected(null);
    setConfirmation(null);
    try {
      const res = await search(slug, { checkIn, checkOut, adults });
      setOptions(res.options);
    } catch (err) {
      setSearchError(err instanceof BookingApiError ? err.message : 'Search failed. Try again.');
    } finally {
      setSearching(false);
    }
  }

  async function submitBooking(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBooking(true);
    setBookError(null);
    try {
      const res = await book(slug, {
        roomTypeId: selected.roomTypeId,
        ratePlanId: selected.ratePlanId,
        checkIn,
        checkOut,
        adults,
        guest: {
          firstName: guest.firstName,
          lastName: guest.lastName,
          ...(guest.email ? { email: guest.email } : {}),
          ...(guest.phone ? { phone: guest.phone } : {}),
        },
      });
      setConfirmation(res.confirmation);
    } catch (err) {
      setBookError(err instanceof BookingApiError ? err.message : 'Booking failed. Try again.');
    } finally {
      setBooking(false);
    }
  }

  if (loadError) {
    return (
      <div className="bk-shell">
        <div className="bk-card bk-center">
          <h1>Property not found</h1>
          <p className="bk-muted">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bk-shell">
      {/* Hero */}
      <header className="bk-hero">
        <div className="bk-hero-inner">
          <span className="bk-eyebrow">Direct booking</span>
          <h1>{property?.name ?? 'Loading…'}</h1>
          {property && <p className="bk-hero-sub">{locationLine(property)}</p>}
        </div>
      </header>

      <main className="bk-main">
        {/* Confirmation view */}
        {confirmation ? (
          <div className="bk-card bk-confirm">
            <div className="bk-confirm-badge" aria-hidden="true">✓</div>
            <h2>Booking confirmed</h2>
            <p className="bk-muted">A confirmation has been sent to the guest.</p>
            <dl className="bk-confirm-grid">
              <div><dt>Confirmation</dt><dd className="bk-ref">{confirmation.reference}</dd></div>
              <div><dt>Property</dt><dd>{confirmation.propertyName}</dd></div>
              <div><dt>Room</dt><dd>{confirmation.roomTypeName}</dd></div>
              <div><dt>Guest</dt><dd>{confirmation.guestName}</dd></div>
              <div><dt>Check-in</dt><dd>{confirmation.checkIn}</dd></div>
              <div><dt>Check-out</dt><dd>{confirmation.checkOut}</dd></div>
              <div><dt>Nights</dt><dd>{confirmation.nights}</dd></div>
              <div><dt>Total</dt><dd className="bk-total">{formatMoney(confirmation.totalMinor)}</dd></div>
            </dl>
            <button type="button" className="bk-btn bk-btn-ghost" onClick={() => { setConfirmation(null); setOptions(null); setSelected(null); }}>
              Make another booking
            </button>
          </div>
        ) : (
          <>
            {/* Search bar */}
            <form className="bk-card bk-searchbar" onSubmit={runSearch}>
              <label className="bk-field">
                <span>Check-in</span>
                <input type="date" value={checkIn} max={checkOut} onChange={(e) => setCheckIn(e.target.value)} required />
              </label>
              <label className="bk-field">
                <span>Check-out</span>
                <input type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} required />
              </label>
              <label className="bk-field bk-field-sm">
                <span>Guests</span>
                <input type="number" min={1} max={20} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
              </label>
              <button type="submit" className="bk-btn" disabled={searching}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </form>

            {searchError && <p className="bk-error" role="alert">{searchError}</p>}

            {/* Results */}
            {options && options.length === 0 && (
              <div className="bk-card bk-center"><p className="bk-muted">No rooms available for these dates. Try a different window.</p></div>
            )}

            {options && options.length > 0 && (
              <div className="bk-results">
                {options.map((o) => (
                  <div key={o.roomTypeId} className={`bk-card bk-room ${selected?.roomTypeId === o.roomTypeId ? 'bk-room-selected' : ''}`}>
                    <div className="bk-room-info">
                      <h3>{o.roomTypeName}</h3>
                      {o.description && <p className="bk-muted">{o.description}</p>}
                      <span className="bk-rooms-left">{o.roomsLeft} room{o.roomsLeft === 1 ? '' : 's'} left</span>
                    </div>
                    <div className="bk-room-price">
                      <span className="bk-price">{formatMoney(o.totalMinor)}</span>
                      <span className="bk-muted">{formatMoney(o.avgNightlyMinor)} / night · {o.nights} nights</span>
                      <button type="button" className="bk-btn" onClick={() => setSelected(o)}>
                        {selected?.roomTypeId === o.roomTypeId ? 'Selected' : 'Select'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Guest details + confirm */}
            {selected && (
              <form className="bk-card bk-guest" onSubmit={submitBooking}>
                <h2>Your details</h2>
                <p className="bk-muted">Booking <strong>{selected.roomTypeName}</strong> · {checkIn} → {checkOut} · {formatMoney(selected.totalMinor)}</p>
                <div className="bk-guest-grid">
                  <label className="bk-field"><span>First name</span>
                    <input value={guest.firstName} onChange={(e) => setGuest({ ...guest, firstName: e.target.value })} required />
                  </label>
                  <label className="bk-field"><span>Last name</span>
                    <input value={guest.lastName} onChange={(e) => setGuest({ ...guest, lastName: e.target.value })} required />
                  </label>
                  <label className="bk-field"><span>Email</span>
                    <input type="email" value={guest.email ?? ''} onChange={(e) => setGuest({ ...guest, email: e.target.value })} placeholder="you@email.com" />
                  </label>
                  <label className="bk-field"><span>Phone</span>
                    <input value={guest.phone ?? ''} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} placeholder="+91…" />
                  </label>
                </div>
                <p className="bk-hint">Enter an email or phone so we can send your confirmation.</p>
                {bookError && <p className="bk-error" role="alert">{bookError}</p>}
                <button type="submit" className="bk-btn bk-btn-lg" disabled={booking}>
                  {booking ? 'Confirming…' : `Confirm booking · ${formatMoney(selected.totalMinor)}`}
                </button>
              </form>
            )}
          </>
        )}
      </main>

      <footer className="bk-footer">
        <span>Powered by The Living Canvas PMS</span>
      </footer>
    </div>
  );
}
