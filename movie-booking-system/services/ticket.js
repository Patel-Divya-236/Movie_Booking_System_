/**
 * Ticket PDF generation.
 *
 * One implementation serves both delivery paths: GET /api/bookings/:id/ticket
 * streams this buffer to the browser, and services/notify.js attaches the very
 * same buffer to the confirmation email.
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const BRAND = '#7c3aed';
const INK = '#1a1a2e';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

const { TIER_LABELS } = require('../config/seatLayouts');

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function rupees(n) {
  return `Rs. ${Number(n || 0).toLocaleString('en-IN')}`;
}

/** Group seats by tier: "Recliner: I1, I2  ·  Normal: A5" */
function seatSummary(seats = []) {
  const byTier = {};
  for (const s of seats) {
    const tier = s.tier || 'normal';
    (byTier[tier] = byTier[tier] || []).push(s.id || s);
  }
  return Object.entries(byTier)
    .map(([tier, ids]) => `${TIER_LABELS[tier] || tier}: ${ids.join(', ')}`)
    .join('   •   ');
}

/**
 * @param {object} booking a booking record from DynamoDB
 * @returns {Promise<Buffer>} the rendered PDF
 */
async function generateTicketPdf(booking) {
  // The QR carries the booking reference so gate staff can look it up.
  const qrDataUrl = await QRCode.toDataURL(booking.bookingRef || booking.bookingId, {
    margin: 1,
    width: 300,
    color: { dark: '#000000', light: '#ffffff' },
  });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  const M = 48;
  const cancelled = booking.status === 'cancelled';

  // ---- Header band
  doc.rect(0, 0, W, 96).fill(BRAND);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text('CineCloud', M, 30);
  doc.font('Helvetica').fontSize(10).fillColor('#e9d5ff')
     .text('E-TICKET  •  Present this at the entrance', M, 60);

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
     .text(cancelled ? 'CANCELLED' : 'CONFIRMED', W - M - 140, 38, { width: 140, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#e9d5ff')
     .text(booking.bookingRef || '', W - M - 140, 54, { width: 140, align: 'right' });

  let y = 132;

  // ---- Movie
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22)
     .text(booking.movieTitle || 'Movie', M, y, { width: W - M * 2 - 150 });
  y = doc.y + 6;

  const tags = [booking.format, booking.language, booking.certificate].filter(Boolean).join('  •  ');
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(tags, M, y);
  y = doc.y + 22;

  // ---- QR, top right
  doc.image(qrBuffer, W - M - 120, 128, { width: 120, height: 120 });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
     .text('Scan at entry', W - M - 120, 252, { width: 120, align: 'center' });

  // ---- Detail pairs
  const detailWidth = W - M * 2 - 150;
  const pair = (label, value) => {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
       .text(label.toUpperCase(), M, y, { width: detailWidth, characterSpacing: 0.8 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK)
       .text(value || '—', M, doc.y + 2, { width: detailWidth });
    y = doc.y + 14;
  };

  pair('Cinema', `${booking.theatreName || ''}${booking.area ? `, ${booking.area}` : ''}`);
  pair('Screen', booking.screenName);
  pair('Date & Time', `${formatDate(booking.startsAt || booking.date)}   ${booking.time || ''}`);
  pair('Seats', seatSummary(booking.seats));

  // ---- Fare breakdown
  y += 10;
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 18;

  const row = (label, value, bold = false) => {
    const font = bold ? 'Helvetica-Bold' : 'Helvetica';
    const size = bold ? 13 : 11;
    doc.font(font).fontSize(size).fillColor(bold ? INK : MUTED).text(label, M, y);
    doc.font(font).fontSize(size).fillColor(bold ? BRAND : INK)
       .text(value, M, y, { width: W - M * 2, align: 'right' });
    y += bold ? 22 : 18;
  };

  const ticketCount = (booking.seats || []).length;
  row(`Tickets (${ticketCount})`, rupees(booking.subtotal));
  row('Convenience fee', rupees(booking.convenienceFee));
  row('GST (18% on fee)', rupees(booking.gst));

  doc.moveTo(M, y + 2).lineTo(W - M, y + 2).strokeColor(LINE).stroke();
  y += 14;
  row('Total paid', rupees(booking.totalPrice), true);

  // ---- Payment
  y += 6;
  const pay = booking.payment || {};
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(
    `Payment: ${String(pay.mode || '—').toUpperCase()}  •  ${pay.paymentId || '—'}` +
    (pay.simulated ? '  •  SIMULATED (demo booking — no real payment was taken)' : ''),
    M, y, { width: W - M * 2 }
  );
  y = doc.y + 8;
  doc.text(`Booked by ${booking.userName || ''} (${booking.userEmail || ''})`, M, y, { width: W - M * 2 });

  // ---- Cancelled watermark
  if (cancelled) {
    doc.save().rotate(-30, { origin: [W / 2, 420] })
       .font('Helvetica-Bold').fontSize(76).fillColor('#ef4444').opacity(0.18)
       .text('CANCELLED', 0, 380, { width: W, align: 'center' })
       .opacity(1).restore();
  }

  // ---- Footer
  const footerY = doc.page.height - 92;
  doc.moveTo(M, footerY).lineTo(W - M, footerY).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    'Please arrive 15 minutes before showtime. Outside food and beverages are not permitted.\n' +
    `Cancellations are accepted up to 2 hours before the show. Booking ID: ${booking.bookingId}`,
    M, footerY + 12, { width: W - M * 2 }
  );
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    'CineCloud is a student project. Bookings are not real and no payment is processed.',
    M, doc.y + 6, { width: W - M * 2 }
  );

  doc.end();
  return done;
}

module.exports = { generateTicketPdf, seatSummary, formatDate, rupees };
