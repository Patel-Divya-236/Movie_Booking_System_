/**
 * Mail delivery over SMTP.
 *
 * Amazon SES was the original primary provider and has been removed: it never
 * left the sandbox, where it refuses any recipient that is not a verified
 * identity, so in practice every real customer was already being served by the
 * SMTP fallback. Keeping a provider that always failed first only added a
 * wasted round trip to every send and a misleading error in the logs.
 *
 * Gmail is also the better sender on the merits: mail genuinely originates
 * from Google's servers, so SPF and DKIM align for a gmail.com address. SES
 * sending "as" a gmail.com address fails that alignment and is likelier to be
 * filed as spam. Lifting the sandbox would need a verified sending domain,
 * which this project does not own.
 *
 * The transport is provider-agnostic. Gmail is the easy default when an App
 * Password is available, but Google refuses to issue those on some accounts
 * (2-Step Verification disabled, passkey-only, or an organisation policy). Any
 * SMTP service works instead — Brevo, SendGrid, SMTP2GO, Mailjet — via
 * SMTP_HOST/PORT/USER/PASS.
 *
 * With nothing configured, sending is skipped and callers carry on: a booking
 * must never fail because email did.
 */

const nodemailer = require('nodemailer');

/**
 * GMAIL_USER / GMAIL_APP_PASSWORD are a shorthand for smtp.gmail.com so
 * existing setups keep working; an explicit SMTP_HOST takes precedence.
 */
function smtpSettings() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 587;
    return {
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM || process.env.MAIL_FROM || process.env.SMTP_USER,
      label: process.env.SMTP_HOST,
    };
  }

  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: process.env.GMAIL_USER,
      // An App Password, not the account password.
      pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, ''),
      from: process.env.MAIL_FROM || process.env.GMAIL_USER,
      label: 'gmail',
    };
  }

  return null;
}

function mailConfigured() {
  return smtpSettings() !== null;
}

let transport = null;
let transportKey = null;

function getTransport(cfg) {
  // Reused across sends: creating a transport per message would open a new TLS
  // connection every time. Rebuilt only if the settings change.
  const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
  if (!transport || transportKey !== key) {
    transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    transportKey = key;
  }
  return transport;
}

/**
 * @param {object} message { to, subject, text, html?, attachments? }
 * @returns {Promise<{delivered: boolean, provider: string|null, reason?: string}>}
 *          Never throws — callers treat email as best-effort.
 */
async function send(message) {
  const label = `"${message.subject}" to ${message.to}`;
  const cfg = smtpSettings();

  if (!cfg) {
    console.log(`📧 No mail provider configured — skipping ${label}`);
    return { delivered: false, provider: null, reason: 'not_configured' };
  }

  try {
    await getTransport(cfg).sendMail({
      from: `CineCloud <${cfg.from}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
    });
    console.log(`📧 [${cfg.label}] Sent ${label}`);
    return { delivered: true, provider: cfg.label };
  } catch (err) {
    console.warn(`📧 [${cfg.label}] Failed ${label} — ${err.message}`);
    return { delivered: false, provider: null, reason: err.message };
  }
}

/** Which provider is usable — surfaced on /api/health for diagnostics. */
function providers() {
  const cfg = smtpSettings();
  return {
    smtp: cfg ? cfg.label : false,
    primary: cfg ? cfg.label : 'none',
  };
}

module.exports = { send, providers, mailConfigured };
