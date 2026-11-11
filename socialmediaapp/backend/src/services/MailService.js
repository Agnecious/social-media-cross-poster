import nodemailer from 'nodemailer';
import { mailConfig, supportEmail } from '../config/index.js';
import { logger, errInfo } from './logger.js';

/**
 * MailService — sends support emails server-side via SMTP (nodemailer).
 *
 * Config-gated: if SMTP isn't configured (`mailConfig().enabled === false`),
 * `isMailEnabled()` returns false and callers should fall back to the
 * client-side `mailto:` behaviour. The transporter is created lazily and
 * reused.
 */

let transporter = null;
let transporterKey = '';

/** Build (or reuse) the SMTP transporter from current config. */
function getTransporter() {
  const cfg = mailConfig();
  if (!cfg.enabled) return null;
  // Re-create if the relevant config changed (host/port/user).
  const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
  if (!transporter || key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    transporterKey = key;
  }
  return transporter;
}

/** Whether server-side mail sending is configured + available. */
export function isMailEnabled() {
  return mailConfig().enabled;
}

/** Escape a string for safe inclusion in an HTML email body. */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Send a support request to the configured SUPPORT_EMAIL inbox.
 *
 * The subject is built HERE (server-side) from trusted values so a client can't
 * spoof the priority/plan. The customer's email is set as Reply-To so replying
 * goes straight back to them.
 *
 * @param {object} p
 * @param {string} p.fromName   customer display name
 * @param {string} p.fromEmail  customer account email (used as Reply-To)
 * @param {string} p.plan       plan id (e.g. 'agency')
 * @param {string} p.priority   'High' | 'Normal' | 'Standard'
 * @param {string} p.message    the customer's message (already length-capped)
 */
export async function sendSupportEmail({ fromName, fromEmail, plan, priority, message }) {
  const tx = getTransporter();
  if (!tx) throw new Error('Mail is not configured.');

  const cfg = mailConfig();
  const to = supportEmail();
  const planLabel = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Trial';
  const subject = `[${priority} priority] ${fromName} — ${planLabel} plan — Support request`;

  const text = [
    `Name: ${fromName}`,
    `Account email: ${fromEmail}`,
    `Plan: ${planLabel}`,
    `Priority: ${priority}`,
    '',
    'Message:',
    message,
  ].join('\n');

  const html = `
    <p><strong>Name:</strong> ${escapeHtml(fromName)}<br/>
       <strong>Account email:</strong> ${escapeHtml(fromEmail)}<br/>
       <strong>Plan:</strong> ${escapeHtml(planLabel)}<br/>
       <strong>Priority:</strong> ${escapeHtml(priority)}</p>
    <p><strong>Message:</strong></p>
    <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
  `;

  try {
    await tx.sendMail({
      from: cfg.from,
      to,
      replyTo: fromEmail || undefined,
      subject,
      text,
      html,
    });
  } catch (err) {
    logger.error('support email send failed', { error: errInfo(err) });
    throw new Error(describeSmtpError(err));
  }
}

/**
 * Turn an SMTP/nodemailer error into a clearer, actionable message. The most
 * common one by far is Gmail rejecting a normal password (it requires an App
 * Password + 2-Step Verification).
 */
function describeSmtpError(err) {
  const code = err?.responseCode;
  const text = `${err?.response || ''} ${err?.message || ''}`.toLowerCase();

  // Gmail / auth rejection.
  if (
    code === 535 ||
    err?.code === 'EAUTH' ||
    text.includes('username and password not accepted') ||
    text.includes('application-specific password') ||
    text.includes('invalid login')
  ) {
    return (
      'Email login was rejected. For Gmail you must use a 16-character App ' +
      'Password (with 2-Step Verification enabled) in SMTP_PASS — not your normal ' +
      'account password.'
    );
  }
  // Connection problems (wrong host/port, blocked egress, etc.).
  if (err?.code === 'ECONNECTION' || err?.code === 'ETIMEDOUT' || err?.code === 'ESOCKET') {
    return 'Could not reach the mail server. Check SMTP_HOST / SMTP_PORT and network access.';
  }
  return 'Could not send your message. Please try again later.';
}

/**
 * Verify the SMTP connection + credentials without sending an email. Returns
 * { ok } on success or { ok:false, error } with a readable reason. Useful for a
 * startup check or an admin diagnostic.
 */
export async function verifyMail() {
  const tx = getTransporter();
  if (!tx) return { ok: false, error: 'Mail is not configured (SMTP_HOST/USER/PASS).' };
  try {
    await tx.verify();
    return { ok: true };
  } catch (err) {
    logger.warn('SMTP verify failed', { error: errInfo(err) });
    return { ok: false, error: describeSmtpError(err) };
  }
}
