/**
 * Mail delivery with a fallback provider.
 *
 * Amazon SES is tried first, because it is the intended production path and
 * the service this project is built around. While SES is in the sandbox it
 * refuses any recipient that is not a verified identity, which would mean
 * most customers never receive their ticket. When that happens the message is
 * re-sent through Gmail SMTP instead, so delivery does not depend on the
 * sandbox restriction being lifted.
 *
 * Gmail is also the better sender in one respect: mail genuinely originates
 * from Google's servers, so SPF and DKIM align for a gmail.com address. SES
 * sending "as" a gmail.com address fails that alignment and is more likely to
 * be filed as spam.
 *
 * Configure either, both, or neither. With neither, sending is skipped and
 * callers carry on — a booking must never fail because email did.
 */

const nodemailer = require('nodemailer');
const { SESClient, SendRawEmailCommand } = require('@aws-sdk/client-ses');

const PLACEHOLDERS = ['your-verified-email@example.com', 'your-admin-email@example.com'];

function sesConfigured() {
  const from = process.env.SES_FROM_EMAIL;
  return Boolean(from) && !PLACEHOLDERS.includes(from);
}

/**
 * The SMTP fallback is provider-agnostic.
 *
 * Gmail is the easy default when an App Password is available, but Google
 * refuses to issue those on some accounts (2-Step Verification disabled,
 * passkey-only, or an organisation policy). Any SMTP service works instead —
 * Brevo, SendGrid, SMTP2GO, Mailjet — by setting SMTP_HOST/PORT/USER/PASS.
 *
 * GMAIL_USER / GMAIL_APP_PASSWORD stay supported as a shorthand for
 * smtp.gmail.com so existing setups keep working.
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
      from: process.env.SMTP_FROM || process.env.SES_FROM_EMAIL || process.env.SMTP_USER,
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
      from: process.env.GMAIL_USER,
      label: 'gmail',
    };
  }

  return null;
}

function gmailConfigured() {
  return smtpSettings() !== null;
}

function region() {
  return process.env.AWS_REGION || 'ap-south-1';
}

/** Errors that mean "this provider will never deliver to this recipient". */
function isRecipientRejection(err) {
  return err?.name === 'MessageRejected'
    || /not verified/i.test(err?.message || '');
}

/**
 * Build the MIME message once, so both providers send byte-identical mail
 * (including PDF attachments, which SES's simple SendEmail cannot carry).
 */
async function buildMime({ from, to, subject, text, html, attachments }) {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix',
  });
  const built = await transport.sendMail({ from, to, subject, text, html, attachments });
  return built.message;
}

async function sendViaSes(message) {
  const from = `CineCloud <${process.env.SES_FROM_EMAIL}>`;
  const raw = await buildMime({ ...message, from });

  const ses = new SESClient({ region: region() });
  await ses.send(new SendRawEmailCommand({ RawMessage: { Data: raw } }));
}

let smtpTransport = null;
let smtpTransportKey = null;

function getSmtpTransport(cfg) {
  // Reused across sends: creating a transport per message would open a new
  // TLS connection every time. Rebuilt only if the settings change.
  const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
  if (!smtpTransport || smtpTransportKey !== key) {
    smtpTransport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    smtpTransportKey = key;
  }
  return smtpTransport;
}

async function sendViaGmail(message) {
  const cfg = smtpSettings();
  await getSmtpTransport(cfg).sendMail({
    from: `CineCloud <${cfg.from}>`,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments,
  });
}

/**
 * @param {object} message { to, subject, text, html?, attachments? }
 * @returns {Promise<{delivered: boolean, provider: string|null, reason?: string}>}
 *          Never throws — callers treat email as best-effort.
 */
async function send(message) {
  const label = `"${message.subject}" to ${message.to}`;

  if (!sesConfigured() && !gmailConfigured()) {
    console.log(`📧 No mail provider configured — skipping ${label}`);
    return { delivered: false, provider: null, reason: 'not_configured' };
  }

  let sesError = null;

  if (sesConfigured()) {
    try {
      await sendViaSes(message);
      console.log(`📧 [SES] Sent ${label}`);
      return { delivered: true, provider: 'ses' };
    } catch (err) {
      sesError = err;
      const why = isRecipientRejection(err) ? 'recipient not verified (sandbox)' : err.message;
      console.warn(`📧 [SES] Failed ${label} — ${why}`);
    }
  }

  const smtp = smtpSettings();
  if (smtp) {
    try {
      await sendViaGmail(message);
      console.log(`📧 [${smtp.label}] Sent ${label}${sesError ? ' (SES fell back)' : ''}`);
      return { delivered: true, provider: smtp.label, fellBack: Boolean(sesError) };
    } catch (err) {
      console.warn(`📧 [${smtp.label}] Failed ${label} — ${err.message}`);
      return { delivered: false, provider: null, reason: err.message };
    }
  }

  return {
    delivered: false,
    provider: null,
    reason: sesError ? sesError.message : 'no provider available',
  };
}

/** Which providers are usable — surfaced on /api/health for diagnostics. */
function providers() {
  const smtp = smtpSettings();
  return {
    ses: sesConfigured(),
    smtp: smtp ? smtp.label : false,
    primary: sesConfigured() ? 'ses' : smtp ? smtp.label : 'none',
  };
}

module.exports = { send, providers, sesConfigured, gmailConfigured };
