/**
 * Checkout via Razorpay.
 *
 * The simulated modal this replaces chose a payment method itself. Razorpay's
 * own Checkout does that now — UPI, cards, net banking and wallets are its
 * screens, not ours — so the tiles here are informational only: a statement of
 * what is accepted, not a control.
 *
 * The whole exchange lives in this module:
 *
 *   1. ask the server for an order (it prices the seats and holds them)
 *   2. hand the order to Razorpay Checkout
 *   3. send the signed result back for verification, which creates the booking
 *
 * Nothing here decides the amount, and nothing here can confirm a booking —
 * both belong to the server. A caller gets back a booking or null.
 *
 * Test mode: no real money moves. Razorpay's test cards work, and UPI can be
 * approved with success@razorpay.
 */

import { openModal, closeModal } from './modal.js';
import { html, raw, rupees } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';

/** Shown as accepted methods; Razorpay presents the real chooser. */
const ACCEPTED = [
  { icon: '/img/upi.svg', label: 'UPI' },
  { icon: '/img/card.svg', label: 'Cards' },
  { icon: '/img/netbanking.svg', label: 'Net Banking' },
  { icon: '/img/wallet.svg', label: 'Wallets' },
];

/** Razorpay's script is a plain <script> in index.html, not a module. */
function checkoutReady() {
  return typeof window.Razorpay === 'function';
}

/**
 * @returns {Promise<{bookingId:string}|null>} the booking, or null if cancelled
 */
export function openPayment({ totals, show }) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const summaryRows = [
      ['Tickets', `${totals.seats.length} × ${show.movieTitle}`],
      ['Seats', totals.seats.map(s => s.id).join(', ')],
      ['Subtotal', rupees(totals.subtotal)],
      ['Convenience fee', rupees(totals.convenienceFee)],
      ['GST (18% on fee)', rupees(totals.gst)],
    ];

    openModal({
      title: 'Checkout',
      size: 'sm',
      onClose: () => finish(null),
      body: html`
        <div class="pay">
          <div class="pay-banner">
            <strong>Test mode</strong>
            <span>This is a student project running Razorpay in test mode. No real
                  money is charged — use a Razorpay test card, or approve UPI with
                  <code>success@razorpay</code>.</span>
          </div>

          <div class="pay-summary">
            ${raw(summaryRows.map(([label, value]) => html`
              <div class="pay-row"><span>${label}</span><span>${value}</span></div>`).join(''))}
            <div class="pay-row pay-row--total"><span>Amount payable</span><span>${rupees(totals.total)}</span></div>
          </div>

          <p class="pay-accepted-label">Pay with</p>
          <div class="pay-accepted">
            ${raw(ACCEPTED.map(m => html`
              <span class="pay-accepted-item">
                <img src="${m.icon}" alt="" width="24" height="24">
                <span>${m.label}</span>
              </span>`).join(''))}
          </div>

          <button class="btn btn-primary btn-block btn-lg" id="payNow">
            Pay ${rupees(totals.total)}
          </button>
          <button class="btn btn-ghost btn-block" id="payCancel">Cancel</button>
          <p class="pay-hold-note" id="holdNote"></p>
        </div>`,

      onMount(bodyEl) {
        const payBtn = bodyEl.querySelector('#payNow');
        const holdNote = bodyEl.querySelector('#holdNote');

        bodyEl.querySelector('#payCancel').addEventListener('click', () => closeModal());

        payBtn.addEventListener('click', async () => {
          if (!checkoutReady()) {
            holdNote.textContent = 'Payment library could not load — check your connection and reload.';
            return;
          }

          payBtn.disabled = true;
          payBtn.textContent = 'Preparing…';

          let order;
          try {
            // The server prices this and holds the seats. We send seat ids and
            // nothing else — no amount, deliberately.
            order = await api.createOrder({
              showId: show.showId,
              seats: totals.seats.map(s => s.id),
            });
          } catch (err) {
            holdNote.textContent = err.message;
            payBtn.disabled = false;
            payBtn.textContent = `Pay ${rupees(totals.total)}`;
            return;
          }

          holdNote.textContent = `Seats held for ${order.holdMinutes} minutes while you pay.`;
          payBtn.textContent = 'Opening payment…';

          /** Give the seats back rather than making the next person wait. */
          const release = () => api.releaseSeats({
            showId: show.showId,
            seats: totals.seats.map(s => s.id),
            holdId: order.holdId,
          }).catch(() => {});

          const rzp = new window.Razorpay({
            key: order.keyId,
            order_id: order.orderId,
            amount: order.amount,
            currency: order.currency,
            name: 'CineCloud',
            description: `${show.movieTitle} — ${totals.seats.map(s => s.id).join(', ')}`,
            image: '/img/card.svg',
            prefill: {
              name: state.user?.name || '',
              email: state.user?.email || '',
            },
            notes: { seats: totals.seats.map(s => s.id).join(',') },
            theme: { color: '#7c3aed' },

            async handler(response) {
              // Razorpay says it worked; only the server can confirm that.
              bodyEl.innerHTML = html`
                <div class="pay-processing">
                  <div class="pay-spinner"></div>
                  <h4>Confirming your booking…</h4>
                  <p>Payment received. Verifying with the server.</p>
                  <span class="pay-note">Do not close this window</span>
                </div>`;

              try {
                const result = await api.verifyPayment({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                  holdId: order.holdId,
                  showId: show.showId,
                  seats: totals.seats.map(s => s.id),
                });
                finish(result);
                closeModal();
              } catch (err) {
                bodyEl.innerHTML = html`
                  <div class="pay-processing">
                    <div style="font-size:40px">⚠️</div>
                    <h4>We could not confirm that booking</h4>
                    <p>${err.message}</p>
                    <span class="pay-note">Your payment reference is
                      ${response.razorpay_payment_id} — quote it to support.</span>
                  </div>`;
                // Left open on purpose: the reference must stay on screen.
              }
            },

            modal: {
              ondismiss() {
                release();
                payBtn.disabled = false;
                payBtn.textContent = `Pay ${rupees(totals.total)}`;
                holdNote.textContent = 'Payment cancelled — your seats were released.';
              },
            },
          });

          rzp.on('payment.failed', res => {
            release();
            payBtn.disabled = false;
            payBtn.textContent = `Pay ${rupees(totals.total)}`;
            holdNote.textContent = res?.error?.description || 'Payment failed. Please try again.';
          });

          rzp.open();
        });
      },
    });
  });
}
