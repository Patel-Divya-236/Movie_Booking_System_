import { html, raw, spinner, emptyState, rupees, formatDate } from '../dom.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { TIER_META } from '../components/seatGrid.js';
import { toast } from '../components/toast.js';

export async function renderConfirmation(container, { params }) {
  container.innerHTML = spinner();

  let booking = state.lastBooking?.bookingId === params.bookingId ? state.lastBooking : null;
  if (!booking) {
    try {
      booking = await api.booking(params.bookingId);
    } catch (err) {
      container.innerHTML = emptyState({ icon: '⚠️', title: 'Booking not found', message: err.message });
      return;
    }
  }
  state.lastBooking = null;

  const seatsByTier = {};
  for (const s of booking.seats || []) {
    (seatsByTier[s.tier] = seatsByTier[s.tier] || []).push(s.id);
  }

  container.innerHTML = html`
    <div class="confirm">
      <div class="confirm-hero">
        <div class="confirm-tick">✓</div>
        <h1>Booking confirmed</h1>
        <p>We've emailed your ticket. Show the QR code at the entrance.</p>
      </div>

      <div class="ticket">
        <div class="ticket-top">
          ${booking.posterUrl
            ? raw(html`<img class="ticket-poster" src="${booking.posterUrl}" alt="">`)
            : raw(html`<div class="ticket-poster ticket-poster--empty">🎬</div>`)}
          <div class="ticket-headline">
            <h2>${booking.movieTitle}</h2>
            <div class="detail-tags">
              <span class="format-pill format-pill--solid">${booking.format}</span>
              ${booking.language ? raw(html`<span class="tag tag-lang">${booking.language}</span>`) : ''}
              ${booking.certificate ? raw(html`<span class="tag tag-cert">${booking.certificate}</span>`) : ''}
            </div>
            <p class="ticket-ref">Booking ID <strong>${booking.bookingRef}</strong></p>
          </div>
        </div>

        <div class="ticket-perf">
          <div class="ticket-cell">
            <span>Cinema</span>
            <strong>${booking.theatreName}</strong>
            ${booking.area ? raw(html`<small>${booking.area}</small>`) : ''}
          </div>
          <div class="ticket-cell">
            <span>Screen</span>
            <strong>${booking.screenName}</strong>
          </div>
          <div class="ticket-cell">
            <span>Date &amp; time</span>
            <strong>${formatDate(booking.startsAt, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
            <small>${booking.time}</small>
          </div>
        </div>

        <div class="ticket-seats">
          <span>Seats</span>
          <div class="chosen-seats">
            ${raw(Object.entries(seatsByTier).map(([tier, ids]) => html`
              <span class="seat-tag seat-tag--${tier}">
                ${TIER_META[tier]?.icon || ''} ${TIER_META[tier]?.label || tier}: ${ids.join(', ')}
              </span>`).join(''))}
          </div>
        </div>

        <div class="ticket-fare">
          <div class="summary-row"><span>Tickets (${(booking.seats || []).length})</span><span>${rupees(booking.subtotal)}</span></div>
          <div class="summary-row"><span>Convenience fee</span><span>${rupees(booking.convenienceFee)}</span></div>
          <div class="summary-row summary-row--muted"><span>GST</span><span>${rupees(booking.gst)}</span></div>
          <div class="summary-total"><span>Total paid</span><span>${rupees(booking.totalPrice)}</span></div>
        </div>

        <div class="ticket-pay">
          Paid via ${String(booking.payment?.mode || '').toUpperCase()} · ${booking.payment?.paymentId || ''}
          ${booking.payment?.simulated ? raw(html`<span class="sim-flag">Simulated — no real payment</span>`) : ''}
        </div>
      </div>

      <div class="confirm-actions">
        <button class="btn btn-primary btn-lg" id="download">⬇ Download ticket (PDF)</button>
        <a class="btn btn-ghost btn-lg" href="/bookings">My bookings</a>
        <a class="btn btn-ghost btn-lg" href="/">Book another</a>
      </div>
    </div>`;

  const btn = container.querySelector('#download');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      await api.downloadTicket(booking.bookingId, `CineCloud-${booking.bookingRef}.pdf`);
      toast('Ticket downloaded', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇ Download ticket (PDF)';
    }
  });
}
