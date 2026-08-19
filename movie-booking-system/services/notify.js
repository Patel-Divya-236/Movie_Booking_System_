/**
 * Notification content.
 *
 * This module decides *what* to send; services/mailer.js decides *how* —
 * SMTP, via Gmail or any configured provider.
 *
 * SNS is separate and deliberately not used for customer email: it can only
 * reach confirmed topic subscribers and supports neither attachments nor HTML.
 *
 * Everything here is best-effort. A booking is already committed by the time
 * these run, so a mail failure must never surface as a booking failure.
 */

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { generateTicketPdf, seatSummary, formatDate, rupees } = require('./ticket');
const mailer = require('./mailer');

function region() {
  return process.env.AWS_REGION || 'ap-south-1';
}

function snsConfigured() {
  return Boolean(process.env.SNS_BOOKING_TOPIC_ARN);
}

// ------------------------------------------------------------------ email

function buildEmailHtml(booking) {
  const seats = seatSummary(booking.seats);
  const when = `${formatDate(booking.startsAt || booking.date)} at ${booking.time}`;

  const row = (label, value) => `
    <tr>
      <td style="padding:6px 0;color:#6b7280;font-size:13px">${label}</td>
      <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${value}</td>
    </tr>`;

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f7;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:linear-gradient(135deg,#7c3aed,#ec4899);padding:24px">
        <div style="color:#fff;font-size:20px;font-weight:800">CineCloud</div>
        <div style="color:#e9d5ff;font-size:13px;margin-top:4px">Your booking is confirmed</div>
      </div>
      <div style="padding:24px">
        <h1 style="margin:0 0 4px;font-size:20px;color:#111827">${booking.movieTitle}</h1>
        <div style="color:#6b7280;font-size:13px;margin-bottom:18px">
          ${[booking.format, booking.language, booking.certificate].filter(Boolean).join(' &middot; ')}
        </div>
        <table style="width:100%;border-collapse:collapse">
          ${row('Booking ID', booking.bookingRef)}
          ${row('Cinema', `${booking.theatreName}${booking.area ? `, ${booking.area}` : ''}`)}
          ${row('Screen', booking.screenName)}
          ${row('When', when)}
          ${row('Seats', seats)}
        </table>
        <div style="border-top:1px solid #e5e7eb;margin:16px 0"></div>
        <table style="width:100%;border-collapse:collapse">
          ${row(`Tickets (${(booking.seats || []).length})`, rupees(booking.subtotal))}
          ${row('Convenience fee', rupees(booking.convenienceFee))}
          ${row('GST', rupees(booking.gst))}
        </table>
        <div style="border-top:2px solid #111827;margin:12px 0 8px"></div>
        <table style="width:100%">
          <tr>
            <td style="font-size:15px;font-weight:800;color:#111827">Total paid</td>
            <td style="font-size:15px;font-weight:800;color:#7c3aed;text-align:right">${rupees(booking.totalPrice)}</td>
          </tr>
        </table>
        <p style="color:#6b7280;font-size:12px;margin-top:20px;line-height:1.6">
          Your ticket is attached as a PDF — show the QR code at the entrance.
          Please arrive 15 minutes early. Cancellations are accepted up to 2 hours before showtime.
        </p>
        <p style="color:#9ca3af;font-size:11px;margin-top:16px;border-top:1px solid #e5e7eb;padding-top:12px">
          CineCloud is a student project. This booking is a simulation and no payment was processed.
        </p>
      </div>
    </div>
  </div>`;
}

function buildEmailText(booking) {
  return [
    `Hi ${booking.userName},`,
    '',
    'Your CineCloud booking is confirmed.',
    '',
    `Booking ID : ${booking.bookingRef}`,
    `Movie      : ${booking.movieTitle} (${booking.format})`,
    `Cinema     : ${booking.theatreName}${booking.area ? `, ${booking.area}` : ''}`,
    `Screen     : ${booking.screenName}`,
    `When       : ${formatDate(booking.startsAt || booking.date)} at ${booking.time}`,
    `Seats      : ${seatSummary(booking.seats)}`,
    `Total paid : ${rupees(booking.totalPrice)}`,
    '',
    'Your ticket is attached as a PDF — show the QR code at the entrance.',
    '',
    'CineCloud is a student project. This booking is a simulation and no payment was processed.',
  ].join('\n');
}

/** Confirmation email with the ticket PDF attached. */
async function sendTicketEmail(booking, pdfBuffer) {
  const result = await mailer.send({
    to: booking.userEmail,
    subject: `🎟 Booking confirmed — ${booking.movieTitle} (${booking.bookingRef})`,
    text: buildEmailText(booking),
    html: buildEmailHtml(booking),
    attachments: [{
      filename: `CineCloud-${booking.bookingRef}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  });
  return result.delivered;
}

// -------------------------------------------------------------------- SNS

/** Publish a booking alert to the admin topic. */
async function publishAdminAlert(booking) {
  if (!snsConfigured()) {
    console.log('📢 SNS not configured (SNS_BOOKING_TOPIC_ARN unset) — skipping admin alert');
    return false;
  }

  const sns = new SNSClient({ region: region() });
  await sns.send(new PublishCommand({
    TopicArn: process.env.SNS_BOOKING_TOPIC_ARN,
    Subject: `New booking: ${booking.movieTitle} — ${rupees(booking.totalPrice)}`.slice(0, 100),
    Message: [
      'New CineCloud booking',
      '',
      `Reference : ${booking.bookingRef}`,
      `Customer  : ${booking.userName} <${booking.userEmail}>`,
      `Movie     : ${booking.movieTitle} (${booking.format})`,
      `Cinema    : ${booking.theatreName}, ${booking.city}`,
      `Screen    : ${booking.screenName}`,
      `When      : ${formatDate(booking.startsAt || booking.date)} at ${booking.time}`,
      `Seats     : ${seatSummary(booking.seats)}`,
      `Amount    : ${rupees(booking.totalPrice)}`,
      `Booked at : ${booking.bookedAt}`,
    ].join('\n'),
    // Lets subscribers filter, e.g. only alert on big-ticket bookings.
    MessageAttributes: {
      city: { DataType: 'String', StringValue: booking.city || 'unknown' },
      amount: { DataType: 'Number', StringValue: String(booking.totalPrice || 0) },
    },
  }));

  console.log('📢 Admin alert published to SNS');
  return true;
}

// ------------------------------------------------------------------ entry

/**
 * Fire both notifications. Never throws — each channel is reported on its own
 * so one failing doesn't suppress the other.
 */
async function sendBookingNotifications(booking) {
  let pdf = null;
  try {
    pdf = await generateTicketPdf(booking);
  } catch (err) {
    console.warn('Ticket PDF generation failed:', err.message);
  }

  const results = await Promise.allSettled([
    pdf ? sendTicketEmail(booking, pdf) : Promise.resolve(false),
    publishAdminAlert(booking),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`${i === 0 ? 'Ticket email' : 'SNS alert'} failed:`, r.reason?.message || r.reason);
    }
  });

  return { emailed: results[0].value === true, alerted: results[1].value === true };
}

// ----------------------------------------------------------- generic sender

/**
 * Send a plain (no-attachment) email.
 * Returns a boolean rather than throwing, so callers stay best-effort without
 * wrapping every call in a try/catch.
 */
async function sendMail({ to, subject, text, html }) {
  const result = await mailer.send({ to, subject, text, html });
  return result.delivered;
}

/** Wrapper so every transactional email shares one look. */
function shell(heading, subheading, innerHtml) {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f7;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:linear-gradient(135deg,#7c3aed,#ec4899);padding:24px">
        <div style="color:#fff;font-size:20px;font-weight:800">CineCloud</div>
        <div style="color:#e9d5ff;font-size:13px;margin-top:4px">${subheading}</div>
      </div>
      <div style="padding:24px">
        <h1 style="margin:0 0 12px;font-size:19px;color:#111827">${heading}</h1>
        ${innerHtml}
        <p style="color:#9ca3af;font-size:11px;margin-top:20px;border-top:1px solid #e5e7eb;padding-top:12px">
          CineCloud is a student project. Bookings are simulated and no payment is processed.
        </p>
      </div>
    </div>
  </div>`;
}

const button = (href, label) => `
  <a href="${href}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;
     padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;margin:8px 0">${label}</a>`;

// ---------------------------------------------------------- email verification

function baseUrl() {
  // Set APP_BASE_URL in production; the fallback keeps local development working.
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

async function sendVerificationEmail(user, rawToken) {
  const link = `${baseUrl()}/verify?token=${encodeURIComponent(rawToken)}`;

  return sendMail({
    to: user.email,
    subject: 'Verify your CineCloud email address',
    text: [
      `Hi ${user.name},`,
      '',
      'Confirm your email address to finish setting up your CineCloud account:',
      '',
      link,
      '',
      'This link expires in 24 hours.',
      "If you didn't create this account, you can ignore this email.",
    ].join('\n'),
    html: shell(
      `Hi ${user.name}, confirm your email`,
      'Verify your address',
      `<p style="color:#4b5563;font-size:14px;line-height:1.6">
         One click and your account is ready.
       </p>
       ${button(link, 'Verify my email')}
       <p style="color:#6b7280;font-size:12px;line-height:1.6;margin-top:14px">
         Or paste this into your browser:<br>
         <span style="word-break:break-all;color:#7c3aed">${link}</span>
       </p>
       <p style="color:#9ca3af;font-size:12px;margin-top:14px">
         This link expires in 24 hours. If you didn't create this account, ignore this email.
       </p>`
    ),
  });
}

// -------------------------------------------------------------------- support

/**
 * Tell the operator a ticket has arrived.
 *
 * The customer already gets an acknowledgement; nobody was telling the person
 * who has to answer it. Tickets landed in DynamoDB and waited to be noticed in
 * the admin queue, which is only checked if you happen to look.
 *
 * Goes to ADMIN_EMAIL, falling back to the SMTP sender — that address is
 * always configured, so this cannot silently do nothing.
 */
async function sendSupportAlertToAdmin(ticket) {
  const to = process.env.ADMIN_EMAIL || process.env.GMAIL_USER || process.env.SMTP_USER;
  if (!to) return false;

  const link = `${baseUrl()}/support/${ticket.ticketId}`;
  const body = `
    <p style="color:#374151;font-size:14px;margin:0 0 14px">
      <strong>${ticket.userName || 'A customer'}</strong> (${ticket.userEmail})
      raised a ${ticket.category || 'general'} ticket.
    </p>
    <p style="color:#111827;font-size:14px;font-weight:600;margin:0 0 6px">${ticket.subject}</p>
    <p style="color:#6b7280;font-size:13px;white-space:pre-wrap;margin:0">${(ticket.messages && ticket.messages[0] && ticket.messages[0].body) || ''}</p>
    ${button(link, 'Open the ticket')}`;

  return sendMail({
    to,
    subject: `[${ticket.ticketRef}] ${ticket.subject}`,
    text: [
      `New CineCloud support ticket: ${ticket.ticketRef}`,
      '',
      `From    : ${ticket.userName || 'unknown'} <${ticket.userEmail}>`,
      `Category: ${ticket.category || 'general'}`,
      `Subject : ${ticket.subject}`,
      '',
      (ticket.messages && ticket.messages[0] && ticket.messages[0].body) || '',
      '',
      link,
    ].join('\n'),
    html: shell('New support ticket', ticket.ticketRef, body),
  });
}

// ----------------------------------------------------------- password reset

/**
 * Emailed reset link.
 *
 * Short-lived by design — a reset link is a bearer credential for the account,
 * so it lives for an hour rather than the 24 hours a signup link gets. The
 * message names the expiry and says plainly what to do if it was not
 * requested, because an unexpected reset email is exactly how someone finds
 * out their address is being targeted.
 */
async function sendPasswordResetEmail(user, rawToken, validForMinutes) {
  const link = `${baseUrl()}/reset?token=${encodeURIComponent(rawToken)}`;

  const body = `
    <p style="color:#374151;font-size:14px;margin:0 0 8px">
      Hi ${user.name || 'there'}, someone asked to reset the password for this account.
    </p>
    <p style="color:#374151;font-size:14px;margin:0 0 4px">
      Use the button below to choose a new one. The link works once and expires
      in ${validForMinutes} minutes.
    </p>
    ${button(link, 'Choose a new password')}
    <p style="color:#6b7280;font-size:12px;margin:12px 0 0">
      Or paste this into your browser:<br>
      <span style="color:#7c3aed;word-break:break-all">${link}</span>
    </p>
    <p style="color:#6b7280;font-size:12.5px;margin:16px 0 0">
      If this was not you, ignore this email — your password stays as it is and
      nothing has changed.
    </p>`;

  return sendMail({
    to: user.email,
    subject: 'Reset your CineCloud password',
    text: [
      `Hi ${user.name || 'there'},`,
      '',
      'Someone asked to reset the password for this CineCloud account.',
      `Open this link to choose a new one (works once, expires in ${validForMinutes} minutes):`,
      '',
      link,
      '',
      'If this was not you, ignore this email — nothing has changed.',
    ].join('\n'),
    html: shell('Reset your password', 'Password reset requested', body),
  });
}

// ------------------------------------------------------------- cancellation

/**
 * Confirm a cancellation in writing.
 *
 * Sent after the seats are actually released, never before — the release is a
 * conditional transaction that can legitimately fail (two cancel clicks
 * racing), and telling someone their booking is cancelled when it isn't is
 * worse than sending nothing.
 *
 * Deliberately restates what was cancelled. A bare "your booking is
 * cancelled" leaves someone with several bookings unable to tell which one
 * went, and that is exactly when people write to support.
 */
async function sendCancellationEmail(booking) {
  const when = `${formatDate(booking.startsAt || booking.date)} at ${booking.time}`;
  const seats = seatSummary(booking.seats);

  const row = (label, value) => `
    <tr>
      <td style="padding:6px 0;color:#6b7280;font-size:13px">${label}</td>
      <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${value}</td>
    </tr>`;

  const body = `
    <p style="color:#374151;font-size:14px;margin:0 0 16px">
      Your booking for <strong>${booking.movieTitle}</strong> has been cancelled and those
      seats are back on sale.
    </p>
    <table style="width:100%;border-collapse:collapse">
      ${row('Booking ID', booking.bookingRef)}
      ${row('Cinema', `${booking.theatreName}${booking.area ? `, ${booking.area}` : ''}`)}
      ${row('When', when)}
      ${row('Seats released', seats)}
      ${row('Amount paid', rupees(booking.totalPrice))}
    </table>
    <p style="color:#6b7280;font-size:12.5px;margin:16px 0 0">
      No refund is issued because no payment was taken — CineCloud is a student
      project and every booking is simulated.
    </p>
    ${button(baseUrl(), 'Book something else')}`;

  return sendMail({
    to: booking.userEmail,
    subject: `Booking cancelled — ${booking.movieTitle} (${booking.bookingRef})`,
    text: [
      `Your CineCloud booking has been cancelled.`,
      ``,
      `${booking.movieTitle}`,
      `Booking ID   : ${booking.bookingRef}`,
      `Cinema       : ${booking.theatreName}${booking.area ? `, ${booking.area}` : ''}`,
      `When         : ${when}`,
      `Seats released: ${seats}`,
      ``,
      `Those seats are available to book again.`,
      `No refund is issued because no payment was taken — bookings here are simulated.`,
    ].join('\n'),
    html: shell('Booking cancelled', 'Your seats have been released', body),
  });
}

async function sendSupportTicketRaised(ticket) {
  const link = `${baseUrl()}/support/${ticket.ticketId}`;

  return sendMail({
    to: ticket.userEmail,
    subject: `[${ticket.ticketRef}] We've received your request`,
    text: [
      `Hi ${ticket.userName},`,
      '',
      `Thanks for getting in touch. Your reference is ${ticket.ticketRef}.`,
      '',
      `Subject: ${ticket.subject}`,
      '',
      'What you told us:',
      ticket.messages[0].body,
      '',
      `Track it here: ${link}`,
      '',
      'We will reply by email as soon as we can.',
    ].join('\n'),
    html: shell(
      "We've got your request",
      `Reference ${ticket.ticketRef}`,
      `<p style="color:#4b5563;font-size:14px;line-height:1.6">
         Hi ${ticket.userName}, thanks for getting in touch. We'll reply by email as soon as we can.
       </p>
       <table style="width:100%;border-collapse:collapse;margin:14px 0">
         <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Reference</td>
             <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right">${ticket.ticketRef}</td></tr>
         <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Subject</td>
             <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right">${ticket.subject}</td></tr>
       </table>
       <div style="background:#f9fafb;border-left:3px solid #e5e7eb;padding:12px;border-radius:4px;
                   color:#4b5563;font-size:13px;white-space:pre-wrap">${ticket.messages[0].body}</div>
       ${button(link, 'View your ticket')}`
    ),
  });
}

async function sendSupportReply(ticket, reply) {
  const link = `${baseUrl()}/support/${ticket.ticketId}`;

  return sendMail({
    to: ticket.userEmail,
    subject: `[${ticket.ticketRef}] Reply from CineCloud support`,
    text: [
      `Hi ${ticket.userName},`,
      '',
      `We've replied to your request (${ticket.ticketRef}).`,
      '',
      reply.body,
      '',
      `Continue the conversation here: ${link}`,
    ].join('\n'),
    html: shell(
      'Support has replied',
      `Reference ${ticket.ticketRef}`,
      `<p style="color:#4b5563;font-size:14px;line-height:1.6">Hi ${ticket.userName},</p>
       <div style="background:#f9fafb;border-left:3px solid #7c3aed;padding:12px;border-radius:4px;
                   color:#374151;font-size:13px;white-space:pre-wrap;margin:12px 0">${reply.body}</div>
       ${button(link, 'Reply on the site')}`
    ),
  });
}

module.exports = {
  sendBookingNotifications,
  sendTicketEmail,
  publishAdminAlert,
  sendMail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendCancellationEmail,
  sendSupportTicketRaised,
  sendSupportAlertToAdmin,
  sendSupportReply,
};
