import { html, raw, spinner, emptyState, rupees, formatDate } from '../dom.js';
import { isAdmin } from '../state.js';
import { api } from '../api.js';
import { TIER_META } from '../components/seatGrid.js';
import { toast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';

const CANCEL_CUTOFF_MINUTES = 120;

function minutesUntil(startsAt) {
  return (new Date(startsAt).getTime() - Date.now()) / 60000;
}

function bookingCard(booking) {
  const cancelled = booking.status === 'cancelled';
  const mins = minutesUntil(booking.startsAt);
  const past = mins < 0;
  const canCancel = !cancelled && mins >= CANCEL_CUTOFF_MINUTES;

  const seatList = (booking.seats || [])
    .map(s => `${TIER_META[s.tier]?.icon || ''} ${s.id}`)
    .join('  ');

  let statusLabel = 'Confirmed', statusClass = 'is-confirmed';
  if (cancelled) { statusLabel = 'Cancelled'; statusClass = 'is-cancelled'; }
  else if (past) { statusLabel = 'Completed'; statusClass = 'is-past'; }

  return html`
    <article class="booking-card ${cancelled ? 'is-cancelled' : ''}">
      ${booking.posterUrl
        ? raw(html`<img class="booking-poster" src="${booking.posterUrl}" alt="" loading="lazy">`)
        : raw(html`<div class="booking-poster booking-poster--empty">🎬</div>`)}

      <div class="booking-body">
        <div class="booking-title-row">
          <h3>${booking.movieTitle}</h3>
          <span class="status-pill ${statusClass}">${statusLabel}</span>
        </div>

        <p class="booking-line">
          ${booking.theatreName}${booking.area ? `, ${booking.area}` : ''} · ${booking.screenName}
        </p>
        <p class="booking-line">
          ${formatDate(booking.startsAt, { weekday: 'short', day: 'numeric', month: 'short' })} ·
          ${booking.time} ·
          <span class="format-pill">${booking.format}</span>
        </p>
        <p class="booking-line booking-seats">${seatList}</p>
        <p class="booking-ref">${booking.bookingRef}</p>
      </div>

      <div class="booking-side">
        <div class="booking-amount">${rupees(booking.totalPrice)}</div>
        <div class="booking-buttons">
          <button class="btn btn-ghost btn-sm" data-download="${booking.bookingId}" data-ref="${booking.bookingRef}">
            ⬇ Ticket
          </button>
          ${canCancel
            ? raw(html`<button class="btn btn-danger btn-sm" data-cancel="${booking.bookingId}">Cancel</button>`)
            : (!cancelled && !past
                ? raw(html`<span class="cancel-note" title="Cancellations close 2 hours before showtime">Cancellation closed</span>`)
                : '')}
        </div>
      </div>
    </article>`;
}

export async function renderMyBookings(container) {
  container.innerHTML = html`
    <div class="page-head">
      <h1>${isAdmin() ? 'All bookings' : 'My bookings'}</h1>
      <p>${isAdmin() ? 'Every booking across the platform' : 'Your tickets, newest first'}</p>
    </div>
    <div id="listHost">${raw(spinner())}</div>`;

  const host = container.querySelector('#listHost');

  async function load() {
    host.innerHTML = spinner();
    try {
      const bookings = await api.bookings();
      host.innerHTML = bookings.length
        ? `<div class="booking-list">${bookings.map(bookingCard).join('')}</div>`
        : emptyState({
            icon: '🎟',
            title: 'No bookings yet',
            message: 'Once you book a show, your tickets appear here.',
            action: '<a class="btn btn-primary" href="/" style="margin-top:16px">Browse movies</a>',
          });
    } catch (err) {
      host.innerHTML = emptyState({ icon: '⚠️', title: 'Could not load bookings', message: err.message });
    }
  }

  host.addEventListener('click', async e => {
    const downloadBtn = e.target.closest('[data-download]');
    if (downloadBtn) {
      downloadBtn.disabled = true;
      try {
        await api.downloadTicket(downloadBtn.dataset.download, `CineCloud-${downloadBtn.dataset.ref}.pdf`);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        downloadBtn.disabled = false;
      }
      return;
    }

    const cancelBtn = e.target.closest('[data-cancel]');
    if (!cancelBtn) return;

    // A real confirm step — cancelling releases seats and can't be undone.
    openModal({
      title: 'Cancel this booking?',
      size: 'sm',
      body: html`
        <p class="modal-lede">
          Your seats go back on sale immediately and this can't be undone.
        </p>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="keep">Keep booking</button>
          <button class="btn btn-danger" id="confirmCancel">Yes, cancel it</button>
        </div>`,
      onMount(bodyEl) {
        bodyEl.querySelector('#keep').addEventListener('click', closeModal);
        bodyEl.querySelector('#confirmCancel').addEventListener('click', async () => {
          const btn = bodyEl.querySelector('#confirmCancel');
          btn.disabled = true;
          btn.textContent = 'Cancelling…';
          try {
            const res = await api.cancelBooking(cancelBtn.dataset.cancel);
            closeModal();
            toast(res.message, 'success');
            load();
          } catch (err) {
            closeModal();
            toast(err.message, 'error');
          }
        });
      },
    });
  });

  load();
}
