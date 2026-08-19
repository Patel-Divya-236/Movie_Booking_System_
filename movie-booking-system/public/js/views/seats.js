import { html, raw, spinner, emptyState, rupees, formatDate } from '../dom.js';
import { state, isLoggedIn, toggleSeat, selectionTotals, resetSelection } from '../state.js';
import { api } from '../api.js';
import { renderSeatGrid, TIER_META } from '../components/seatGrid.js';
import { openPayment } from '../components/paymentModal.js';
import { toast } from '../components/toast.js';
import { setPostAuthRedirect } from './auth.js';
import * as router from '../router.js';

export async function renderSeats(container, { params }) {
  container.innerHTML = spinner();
  resetSelection();

  let data;
  try {
    data = await api.show(params.showId);
  } catch (err) {
    container.innerHTML = emptyState({ icon: '⚠️', title: 'Show not found', message: err.message });
    return;
  }

  const { show, layout, bookedSeats } = data;
  state.show = show;
  state.layout = layout;
  state.bookedSeats = bookedSeats;

  const maxSeats = state.config?.fees?.maxSeatsPerBooking || 10;

  container.innerHTML = html`
    <a class="back-link" href="/movie/${show.movieId}/shows?date=${show.date}">← Change showtime</a>

    <div class="booking-head">
      <div>
        <h1>${show.movieTitle}</h1>
        <p>
          ${show.theatreName}${show.area ? `, ${show.area}` : ''} ·
          ${show.screenName} ·
          ${formatDate(show.startsAt, { weekday: 'short', day: 'numeric', month: 'short' })}, ${show.time}
        </p>
      </div>
      <span class="format-pill format-pill--solid format-pill--lg">${show.format}</span>
    </div>

    <div class="booking-layout">
      <div id="gridHost"></div>
      <aside class="summary" id="summary"></aside>
    </div>`;

  const gridHost = container.querySelector('#gridHost');
  const summaryHost = container.querySelector('#summary');

  function paintGrid() {
    gridHost.innerHTML = renderSeatGrid({
      layout,
      prices: show.prices,
      bookedSeats: state.bookedSeats,
      selectedSeats: state.selectedSeats,
    });
  }

  function paintSummary() {
    const totals = selectionTotals();
    const count = totals.seats.length;

    const tierRows = Object.entries(totals.byTier).map(([tier, info]) => html`
      <div class="summary-row">
        <span>${TIER_META[tier]?.label || tier} × ${info.count}</span>
        <span>${rupees(info.amount)}</span>
      </div>`).join('');

    summaryHost.innerHTML = html`
      <h3>Your selection</h3>

      ${count === 0
        ? raw(html`<p class="summary-empty">Tap the seats you want on the map.</p>`)
        : raw(html`
          <div class="chosen-seats">
            ${raw(totals.seats.map(s => html`
              <span class="seat-tag seat-tag--${s.tier}">${TIER_META[s.tier]?.icon || ''} ${s.id}</span>`).join(''))}
          </div>
          <div class="summary-rows">
            ${raw(tierRows)}
            <div class="summary-row"><span>Convenience fee</span><span>${rupees(totals.convenienceFee)}</span></div>
            <div class="summary-row summary-row--muted"><span>GST (18% on fee)</span><span>${rupees(totals.gst)}</span></div>
          </div>
          <div class="summary-total">
            <span>Total</span>
            <span>${rupees(totals.total)}</span>
          </div>`)}

      <button class="btn btn-primary btn-block btn-lg" id="payBtn" ${raw(count === 0 ? 'disabled' : '')}>
        ${isLoggedIn()
          ? (count === 0 ? 'Select seats' : `Pay ${rupees(totals.total)}`)
          : 'Sign in to book'}
      </button>

      <p class="summary-note">Up to ${maxSeats} seats per booking. Demo checkout — no real payment is taken.</p>`;

    summaryHost.querySelector('#payBtn').addEventListener('click', checkout);
  }

  gridHost.addEventListener('click', e => {
    const btn = e.target.closest('[data-seat]');
    if (!btn || btn.disabled) return;

    if (!isLoggedIn()) {
      setPostAuthRedirect(router.currentPath());
      toast('Sign in to pick your seats', 'info');
      return router.go('/login');
    }

    const { seat, tier } = btn.dataset;
    const price = show.prices[tier];
    const result = toggleSeat(seat, tier, price, maxSeats);
    if (result.limitReached) {
      toast(`You can book at most ${maxSeats} seats at a time`, 'error');
      return;
    }

    paintGrid();
    paintSummary();
  });

  async function refreshTakenSeats() {
    try {
      const { bookedSeats: taken } = await api.seatsFor(show.showId);
      state.bookedSeats = taken;
      // Drop anything that was claimed while the user was deciding.
      state.selectedSeats = state.selectedSeats.filter(s => !taken.includes(s.id));
      paintGrid();
      paintSummary();
    } catch { /* a failed refresh shouldn't break the page */ }
  }

  async function checkout() {
    if (!isLoggedIn()) {
      setPostAuthRedirect(router.currentPath());
      return router.go('/login');
    }
    if (!state.selectedSeats.length) return;

    const totals = selectionTotals();
    // openPayment now owns the whole exchange — order, Razorpay Checkout and
    // server-side verification — and hands back a finished booking.
    let result;
    try {
      result = await openPayment({ totals, show });
    } catch (err) {
      toast(err.message, 'error');
      await refreshTakenSeats();
      return;
    }
    if (!result) return; // cancelled or failed; the modal explained why

    state.lastBooking = result.booking;
    router.go(`/booking/${result.bookingId}`, { replace: true });
  }

  paintGrid();
  paintSummary();
}
