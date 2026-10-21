import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { FormField } from '../components/FormField';
import { createProperty } from '../features/properties/api';
import { createRatePlan, setRates } from '../features/rate-plans/api';
import { createRoomType } from '../features/room-types/api';
import { createRoom } from '../features/rooms/api';
import { ApiError } from '../lib/api';
import { slugify, validateRequired } from '../lib/validation';
import './onboarding.css';

/**
 * First-run setup wizard (shown right after signup). Three short steps take
 * a brand-new workspace from empty to bookable — the same "activation" path
 * Mews/Cloudbeds walk a new property through:
 *   1. Property  2. First room type + nightly rate  3. Rooms
 * Every step calls the real API (validation, audit, tenancy all apply).
 * Skippable at any point; nothing here is required to use the app.
 */

type Step = 0 | 1 | 2 | 3;

const STEPS = ['Your property', 'Room type & rate', 'Rooms'];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [roomTypeId, setRoomTypeId] = useState<string | null>(null);

  const [property, setProperty] = useState({ name: '', city: '', country: 'India' });
  const [roomType, setRoomType] = useState({ name: 'Deluxe King', rate: '4500' });
  const [rooms, setRooms] = useState({ prefix: '1', count: '5' });

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function submitProperty(e: FormEvent) {
    e.preventDefault();
    const nameErr = validateRequired(property.name, 'Property name', 2);
    setErrors({ name: nameErr });
    if (nameErr) return;
    void run(async () => {
      const created = await createProperty({
        name: property.name.trim(),
        slug: `${slugify(property.name) || 'property'}-${Date.now().toString(36).slice(-4)}`,
        city: property.city.trim() || undefined,
        country: property.country.trim() || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
      setPropertyId(created.id);
      setStep(1);
    });
  }

  function submitRoomType(e: FormEvent) {
    e.preventDefault();
    const rate = Number(roomType.rate);
    const next = {
      rtName: validateRequired(roomType.name, 'Room type name'),
      rate: Number.isFinite(rate) && rate > 0 && rate <= 1_000_000 ? undefined : 'Enter a nightly rate between 1 and 10,00,000.',
    };
    setErrors(next);
    if (next.rtName || next.rate || !propertyId) return;
    void run(async () => {
      const rt = await createRoomType(propertyId, { name: roomType.name.trim() });
      const plan = await createRatePlan(propertyId, rt.id, { name: 'Best Available Rate', code: 'BAR', isRefundable: true });
      // Load the next 365 nights at this price so the property is bookable today.
      const start = new Date();
      const rates = Array.from({ length: 365 }, (_, i) => {
        const d = new Date(start);
        d.setUTCDate(d.getUTCDate() + i);
        return { date: isoDate(d), amountMinor: Math.round(rate * 100) };
      });
      await setRates(propertyId, rt.id, plan.id, rates);
      setRoomTypeId(rt.id);
      setStep(2);
    });
  }

  function submitRooms(e: FormEvent) {
    e.preventDefault();
    const count = Number(rooms.count);
    const next = { count: Number.isInteger(count) && count >= 1 && count <= 50 ? undefined : 'Choose between 1 and 50 rooms.' };
    setErrors(next);
    if (next.count || !propertyId || !roomTypeId) return;
    void run(async () => {
      for (let i = 1; i <= count; i += 1) {
        await createRoom(propertyId, {
          name: `${rooms.prefix}${String(i).padStart(2, '0')}`,
          roomTypeId,
          floor: rooms.prefix || undefined,
        });
      }
      setStep(3);
    });
  }

  return (
    <section className="onboarding">
      <header className="onboarding-head">
        <span className="onboarding-eyebrow">Getting started</span>
        <h1>{step === 3 ? 'You’re ready to take bookings 🎉' : 'Let’s set up your first property'}</h1>
        <p>
          {step === 3
            ? 'Your property, rooms and rates are live. Here’s where to go next.'
            : 'Three quick steps. You can change everything later, or skip and explore on your own.'}
        </p>
      </header>

      <ol className="onboarding-steps" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? 'done' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="onboarding-step-dot">{i < step ? '✓' : i + 1}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      <div className="onboarding-card">
        {step === 0 && (
          <form onSubmit={submitProperty} noValidate className="onboarding-form">
            <FormField
              label="Property name"
              value={property.name}
              onChange={(e) => setProperty({ ...property, name: e.target.value })}
              placeholder="The Seaside Residency"
              error={errors.name}
              autoFocus
            />
            <div className="onboarding-grid">
              <FormField label="City" value={property.city} onChange={(e) => setProperty({ ...property, city: e.target.value })} placeholder="Goa" />
              <FormField label="Country" value={property.country} onChange={(e) => setProperty({ ...property, country: e.target.value })} />
            </div>
            <Actions busy={busy} label="Create property" />
          </form>
        )}

        {step === 1 && (
          <form onSubmit={submitRoomType} noValidate className="onboarding-form">
            <FormField
              label="Room type"
              value={roomType.name}
              onChange={(e) => setRoomType({ ...roomType, name: e.target.value })}
              error={errors.rtName}
              hint="e.g. Standard Queen, Deluxe King, Suite"
              autoFocus
            />
            <FormField
              label="Nightly rate (₹)"
              type="number"
              inputMode="numeric"
              min={1}
              value={roomType.rate}
              onChange={(e) => setRoomType({ ...roomType, rate: e.target.value })}
              error={errors.rate}
              hint="Applied to the next 365 nights as your Best Available Rate."
            />
            <Actions busy={busy} label="Save room type" />
          </form>
        )}

        {step === 2 && (
          <form onSubmit={submitRooms} noValidate className="onboarding-form">
            <div className="onboarding-grid">
              <FormField
                label="Floor / prefix"
                value={rooms.prefix}
                onChange={(e) => setRooms({ ...rooms, prefix: e.target.value.slice(0, 3) })}
                hint={`Rooms will be named ${rooms.prefix}01, ${rooms.prefix}02…`}
              />
              <FormField
                label="How many rooms?"
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                value={rooms.count}
                onChange={(e) => setRooms({ ...rooms, count: e.target.value })}
                error={errors.count}
              />
            </div>
            <Actions busy={busy} label="Create rooms" />
          </form>
        )}

        {step === 3 && propertyId && (
          <div className="onboarding-next">
            <Link className="onboarding-tile" to={`/app/properties/${propertyId}/calendar`}>
              <strong>Open the tape chart</strong>
              <span>See every room × night and drag bookings around.</span>
            </Link>
            <Link className="onboarding-tile" to={`/app/properties/${propertyId}/reservations`}>
              <strong>Take your first booking</strong>
              <span>Create a reservation and check a guest in.</span>
            </Link>
            <Link className="onboarding-tile" to={`/app/properties/${propertyId}/dashboard`}>
              <strong>Front-desk dashboard</strong>
              <span>Arrivals, departures, occupancy and housekeeping.</span>
            </Link>
            <Link className="onboarding-tile" to="/app/settings">
              <strong>Account settings</strong>
              <span>Verify your email and manage your account.</span>
            </Link>
          </div>
        )}

        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {step < 3 && (
        <button type="button" className="onboarding-skip" onClick={() => navigate('/app')}>
          Skip for now — I’ll explore first
        </button>
      )}
    </section>
  );
}

function Actions({ busy, label }: { busy: boolean; label: string }) {
  return (
    <div className="onboarding-actions">
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? <span className="btn-spinner" aria-hidden="true" /> : null}
        {busy ? 'Saving…' : label}
      </button>
    </div>
  );
}
