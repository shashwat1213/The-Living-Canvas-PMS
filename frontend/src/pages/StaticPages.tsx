import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { CONTACT_EMAIL, PublicLayout } from './PublicLayout';

const LAST_UPDATED = '20 October 2026';

function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · The Living Canvas`;
  }, [title]);
}

export function PrivacyPage() {
  useTitle('Privacy Policy');
  return (
    <PublicLayout>
      <article className="legal">
        <h1>Privacy Policy</h1>
        <p className="legal-meta">Last updated: {LAST_UPDATED}</p>

        <p>
          The Living Canvas (“we”, “us”) is a hotel property management system. This policy explains what personal data
          we process when you use the app at this website, why, and the choices you have. The service is currently
          operated as a portfolio / demonstration project; please do not enter real guest data you are not permitted to
          share.
        </p>

        <h2>1. Data we collect</h2>
        <ul>
          <li>
            <strong>Account data</strong> — name, email address, organization name and a password (stored only as an
            Argon2id hash; we never see or store your password in plain text).
          </li>
          <li>
            <strong>Workspace data you enter</strong> — properties, rooms, rates, reservations, guest records, folios,
            housekeeping and maintenance records. You (the hotel) are the controller of guest data; we process it on
            your behalf.
          </li>
          <li>
            <strong>Security &amp; session data</strong> — IP address, browser user-agent and sign-in timestamps, used
            for session management, rate limiting and the audit trail.
          </li>
          <li>
            <strong>Usage analytics</strong> — anonymous, cookie-less page-view statistics (Vercel Web Analytics). No
            advertising trackers are used.
          </li>
          <li>
            <strong>Error reports</strong> — when something breaks, a technical error report (stack trace, page, browser)
            is sent to our error-tracking provider (Sentry). We do not attach form contents, cookies or passwords.
          </li>
        </ul>

        <h2>2. Why we use it</h2>
        <ul>
          <li>To provide the service: authenticate you, store and show your workspace data.</li>
          <li>To keep it secure: prevent abuse (CAPTCHA, rate limiting), investigate incidents, keep an audit trail.</li>
          <li>To send essential emails: email verification and password resets. We do not send marketing email.</li>
          <li>To improve reliability and usability using aggregated analytics and error reports.</li>
        </ul>

        <h2>3. Cookies</h2>
        <p>
          We use one strictly-necessary, httpOnly cookie to keep you signed in (a refresh-session token). We do not use
          advertising or cross-site tracking cookies. The security check on sign-up (Cloudflare Turnstile) may set its
          own strictly-necessary cookies to tell humans and bots apart.
        </p>

        <h2>4. Who we share it with</h2>
        <p>We never sell personal data. We use these sub-processors to run the service:</p>
        <ul>
          <li>Vercel — application hosting and anonymous web analytics.</li>
          <li>Neon — managed PostgreSQL database hosting.</li>
          <li>Google (Gmail SMTP) — delivery of transactional emails.</li>
          <li>Cloudflare — Turnstile bot protection.</li>
          <li>Sentry — error tracking.</li>
          <li>Groq — processes the text of questions you ask the in-app AI assistant / marketing studio.</li>
        </ul>

        <h2>5. Security</h2>
        <p>
          Data is encrypted in transit (HTTPS) and at rest by our hosting providers. Each organization’s data is isolated
          both in the application and in the database itself (PostgreSQL row-level security). Access inside an
          organization is controlled by roles and per-property permissions, and changes are recorded in an audit log.
        </p>

        <h2>6. Retention &amp; deletion</h2>
        <p>
          We keep your data while your account exists. You can delete your account at any time from{' '}
          <strong>Account settings → Delete account</strong>. If you are the organization’s only owner, this permanently
          deletes the whole organization and all of its data immediately. Encrypted database backups roll off within 7
          days.
        </p>

        <h2>7. Your rights</h2>
        <p>
          Depending on where you live (for example under India’s DPDP Act 2023 or the EU GDPR) you may have the right to
          access, correct, export or delete your personal data, and to object to or restrict processing. Most of this you
          can do yourself in the app; for anything else email us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <h2>8. Children</h2>
        <p>The service is intended for businesses and is not directed at anyone under 18.</p>

        <h2>9. Changes</h2>
        <p>We will update this page if our practices change and revise the “Last updated” date above.</p>

        <h2>10. Contact</h2>
        <p>
          Questions about privacy: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </article>
    </PublicLayout>
  );
}

export function TermsPage() {
  useTitle('Terms of Service');
  return (
    <PublicLayout>
      <article className="legal">
        <h1>Terms of Service</h1>
        <p className="legal-meta">Last updated: {LAST_UPDATED}</p>

        <p>
          These terms govern your use of The Living Canvas property management system (the “Service”). By creating an
          account or using the demo you agree to them.
        </p>

        <h2>1. The Service</h2>
        <p>
          The Living Canvas is provided as a portfolio and demonstration project, free of charge, “as is” and “as
          available”. Features may change, and the Service may be interrupted or discontinued at any time. It is not
          intended to be your system of record for a live hotel operation.
        </p>

        <h2>2. Accounts</h2>
        <ul>
          <li>You must provide accurate information and keep your password confidential.</li>
          <li>You are responsible for activity under your account and for the users you invite to your organization.</li>
          <li>The shared demo workspace is public: anything you type there can be seen by other visitors and may be reset at any time. Do not enter real personal data in it.</li>
        </ul>

        <h2>3. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>break the law, or upload data you do not have the right to process;</li>
          <li>attempt to access other organizations’ data or bypass security, rate limits or CAPTCHA;</li>
          <li>probe, scan or load-test the Service, or use it to send spam;</li>
          <li>reverse-engineer it for the purpose of attacking it.</li>
        </ul>

        <h2>4. Your data</h2>
        <p>
          You keep all rights to the data you enter. You grant us only the permission needed to host and process it to
          provide the Service. Our handling of personal data is described in the <Link to="/privacy">Privacy Policy</Link>.
          You can delete your account and data at any time from Account settings.
        </p>

        <h2>5. AI features</h2>
        <p>
          AI-generated answers and marketing copy may be inaccurate. Review them before relying on or publishing them.
        </p>

        <h2>6. Disclaimer &amp; liability</h2>
        <p>
          To the maximum extent permitted by law, the Service is provided without warranties of any kind, and we are not
          liable for any indirect, incidental or consequential damages, or for loss of data, revenue or bookings arising
          from its use.
        </p>

        <h2>7. Termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend accounts that violate these terms or threaten the
          Service’s security.
        </p>

        <h2>8. Changes &amp; contact</h2>
        <p>
          We may update these terms; continued use after an update means you accept it. Contact:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </article>
    </PublicLayout>
  );
}

export function NotFoundPage() {
  useTitle('Page not found');
  const { status } = useAuth();
  const location = useLocation();
  const inApp = location.pathname.startsWith('/app');
  const home = status === 'authenticated' ? '/app' : '/';

  const body = (
    <div className="notfound">
      <span className="notfound-code" aria-hidden="true">
        404
      </span>
      <h1>This room isn’t on the map</h1>
      <p>
        We couldn’t find <code>{location.pathname}</code>. It may have been moved, or the link might be mistyped.
      </p>
      <div className="notfound-actions">
        <Link to={home} className="btn btn-primary">
          {status === 'authenticated' ? 'Back to dashboard' : 'Go to homepage'}
        </Link>
        <button type="button" className="btn btn-ghost" onClick={() => window.history.back()}>
          Go back
        </button>
      </div>
    </div>
  );

  return inApp ? body : <PublicLayout>{body}</PublicLayout>;
}
