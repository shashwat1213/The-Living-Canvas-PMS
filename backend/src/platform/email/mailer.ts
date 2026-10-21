import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '../../config/env.js';

/**
 * Transactional email (verification, password reset).
 *
 * - SMTP configured (`SMTP_HOST` + `SMTP_USER` + `SMTP_PASS`, e.g. Gmail
 *   with an app password): real delivery.
 * - Not configured (local dev, CI, tests): the message is captured in an
 *   in-memory outbox and the link is logged to the console, so every flow
 *   still works end-to-end without credentials.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const outbox: OutgoingEmail[] = [];

/** Test/dev-only: the messages captured while no SMTP transport is configured. */
export function getOutbox(): readonly OutgoingEmail[] {
  return outbox;
}

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const { host, port, user, pass } = env.smtp;
  transporter =
    host && user && pass
      ? nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
      : null;
  return transporter;
}

export function isEmailDeliveryConfigured(): boolean {
  return getTransporter() !== null;
}

export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    outbox.push(message);
    if (outbox.length > 200) outbox.shift();
    if (!env.isTest) console.log(`[mail] (no SMTP configured) to=${message.to} subject="${message.subject}"\n${message.text}`);
    return;
  }
  await transport.sendMail({ from: env.smtp.from, ...message });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** One branded, inline-styled layout for every transactional email. */
export function renderActionEmail(opts: {
  greetingName: string;
  heading: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
  footnote: string;
}): { html: string; text: string } {
  const name = escapeHtml(opts.greetingName);
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ec;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1f2a24">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e0d2">
<tr><td style="background:#1f3d33;padding:20px 28px;color:#f6f3ec;font-weight:700;font-size:18px;letter-spacing:.2px">The Living Canvas</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(opts.heading)}</h1>
<p style="margin:0 0 8px;font-size:15px;line-height:1.6">Hi ${name},</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6">${escapeHtml(opts.body)}</p>
<a href="${escapeHtml(opts.actionUrl)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${escapeHtml(opts.actionLabel)}</a>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#5d6b63">${escapeHtml(opts.footnote)}</p>
<p style="margin:12px 0 0;font-size:12px;color:#8a958e;word-break:break-all">${escapeHtml(opts.actionUrl)}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Hi ${opts.greetingName},\n\n${opts.body}\n\n${opts.actionLabel}: ${opts.actionUrl}\n\n${opts.footnote}\n\n— The Living Canvas`;
  return { html, text };
}
