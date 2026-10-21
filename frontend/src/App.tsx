import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from './auth/useAuth';
import { BrandMark } from './pages/AuthLayout';
import { PublicFooter } from './pages/PublicLayout';
import './App.css';

const FEATURES = [
  {
    icon: '🗓️',
    title: 'Tape-chart calendar',
    body: 'Every room × night on one board. Drag to assign, move and reschedule stays, with conflict checks.',
  },
  {
    icon: '🛎️',
    title: 'Front-desk cockpit',
    body: 'Arrivals, departures, in-house guests, room readiness and open balances — the daily landing screen.',
  },
  {
    icon: '💳',
    title: 'Folios & payments',
    body: 'Charges, payments, refunds and online payment links, with PDF booking vouchers for guests.',
  },
  {
    icon: '🧹',
    title: 'Housekeeping & maintenance',
    body: 'Room status board, cleaning tasks and work orders that take rooms out of service automatically.',
  },
  {
    icon: '📈',
    title: 'Revenue analytics',
    body: 'Occupancy, ADR and RevPAR trends with month-by-month revenue, POS and collections.',
  },
  {
    icon: '🤖',
    title: 'AI assistant & marketing',
    body: 'Ask questions about your property in plain English, and generate on-brand marketing copy.',
  },
];

const TRUST = [
  'Multi-tenant with Postgres row-level security',
  'Role-based access per property',
  'Full audit trail of every change',
  'Public booking engine for direct bookings',
];

/** Public marketing home — the first thing a recruiter or hotelier sees. */
function App() {
  const { status } = useAuth();
  useEffect(() => {
    document.title = 'The Living Canvas — Hotel property management, beautifully simple';
  }, []);

  return (
    <div className="home-shell">
      <header className="home-nav">
        <Link to="/" className="home-logo">
          <span className="home-logo-mark">
            <BrandMark size={20} />
          </span>
          The Living Canvas
        </Link>
        <nav>
          {status === 'authenticated' ? (
            <Link to="/app" className="home-btn home-btn-primary">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="home-link">
                Log in
              </Link>
              <Link to="/signup" className="home-btn home-btn-primary">
                Start free
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="home-hero">
        <span className="home-eyebrow">Property management system</span>
        <h1>
          Run every property
          <br />
          <span>from one calm workspace.</span>
        </h1>
        <p className="home-lead">
          Reservations, front desk, housekeeping, POS, revenue analytics and an AI assistant — a complete,
          multi-property PMS built for modern hotels.
        </p>
        <div className="home-cta">
          <Link to="/login" state={{ demo: true }} className="home-btn home-btn-primary home-btn-lg">
            ✨ Try the live demo
          </Link>
          <Link to="/signup" className="home-btn home-btn-ghost home-btn-lg">
            Create your workspace
          </Link>
        </div>
        <p className="home-cta-note">No sign-up needed for the demo · one click, fully stocked hotel</p>

        <div className="home-preview" aria-hidden="true">
          <div className="home-preview-bar">
            <span />
            <span />
            <span />
          </div>
          <div className="home-preview-body">
            <div className="home-preview-side">
              {Array.from({ length: 7 }, (_, i) => (
                <i key={i} className={i === 1 ? 'on' : ''} />
              ))}
            </div>
            <div className="home-preview-main">
              <div className="home-preview-kpis">
                {['Arrivals', 'Departures', 'In house', 'Occupancy'].map((k, i) => (
                  <div key={k}>
                    <small>{k}</small>
                    <b>{['12', '9', '41', '86%'][i]}</b>
                  </div>
                ))}
              </div>
              <div className="home-preview-chart">
                {[38, 52, 47, 64, 71, 58, 83, 76, 90, 69, 88, 94].map((h, i) => (
                  <span key={i} style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="home-features">
        <h2>Everything the front desk and the back office need</h2>
        <div className="home-feature-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="home-feature">
              <span className="home-feature-icon" aria-hidden="true">
                {f.icon}
              </span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-trust">
        <div>
          <h2>Built like production software</h2>
          <p>
            A React + TypeScript front end on an Express + Prisma + PostgreSQL API, with server-side authorization on
            every request.
          </p>
        </div>
        <ul>
          {TRUST.map((t) => (
            <li key={t}>
              <span aria-hidden="true">✓</span> {t}
            </li>
          ))}
        </ul>
      </section>

      <section className="home-final">
        <h2>See it with real data in one click.</h2>
        <Link to="/login" state={{ demo: true }} className="home-btn home-btn-primary home-btn-lg">
          Open the live demo
        </Link>
      </section>

      <PublicFooter />
    </div>
  );
}

export default App;
