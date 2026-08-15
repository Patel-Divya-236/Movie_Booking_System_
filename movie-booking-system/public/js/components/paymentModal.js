/**
 * Simulated payment.
 *
 * No gateway is contacted and no card details are collected — the "form" is a
 * choice of method and a fake processing delay. Every screen says so plainly,
 * because a payment UI that looks real but isn't is the one thing here that
 * could genuinely mislead someone.
 */

import { openModal, closeModal } from './modal.js';
import { html, raw, rupees } from '../dom.js';

const METHODS = [
  { id: 'upi',        icon: '/img/upi.svg',        label: 'UPI',          hint: 'Google Pay, PhonePe, Paytm' },
  { id: 'card',       icon: '/img/card.svg',       label: 'Card',         hint: 'Credit or debit' },
  { id: 'netbanking', icon: '/img/netbanking.svg', label: 'Net Banking',  hint: 'All major banks' },
  { id: 'wallet',     icon: '/img/wallet.svg',     label: 'Wallet',       hint: 'Wallet balance' },
];

const PROCESSING_MS = 1800;

/**
 * @returns {Promise<{mode:string}|null>} the chosen method, or null if cancelled
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
            <strong>Demo payment</strong>
            <span>This is a student project. No real money is charged and no card details are collected.</span>
          </div>

          <div class="pay-summary">
            ${raw(summaryRows.map(([label, value]) => html`
              <div class="pay-row"><span>${label}</span><span>${value}</span></div>`).join(''))}
            <div class="pay-row pay-row--total"><span>Amount payable</span><span>${rupees(totals.total)}</span></div>
          </div>

          <div class="pay-methods" role="radiogroup" aria-label="Payment method">
            ${raw(METHODS.map((m, i) => html`
              <button type="button" class="pay-method ${i === 0 ? 'is-active' : ''}"
                      data-method="${m.id}" role="radio" aria-checked="${i === 0 ? 'true' : 'false'}">
                <span class="pay-method-icon"><img src="${m.icon}" alt="" width="26" height="26"></span>
                <span class="pay-method-text">
                  <span class="pay-method-label">${m.label}</span>
                  <span class="pay-method-hint">${m.hint}</span>
                </span>
              </button>`).join(''))}
          </div>

          <button class="btn btn-primary btn-block btn-lg" id="payNow">
            Pay ${rupees(totals.total)}
          </button>
          <button class="btn btn-ghost btn-block" id="payCancel">Cancel</button>
        </div>`,

      onMount(bodyEl) {
        let mode = METHODS[0].id;

        bodyEl.querySelectorAll('.pay-method').forEach(btn => {
          btn.addEventListener('click', () => {
            mode = btn.dataset.method;
            bodyEl.querySelectorAll('.pay-method').forEach(b => {
              const active = b === btn;
              b.classList.toggle('is-active', active);
              b.setAttribute('aria-checked', String(active));
            });
          });
        });

        bodyEl.querySelector('#payCancel').addEventListener('click', () => closeModal());

        bodyEl.querySelector('#payNow').addEventListener('click', () => {
          // Swap the whole dialog for a processing state so nothing is
          // clickable twice while the "payment" runs.
          bodyEl.innerHTML = html`
            <div class="pay-processing">
              <div class="pay-spinner"></div>
              <h4>Processing payment…</h4>
              <p>Simulating a ${METHODS.find(m => m.id === mode).label} payment of ${rupees(totals.total)}</p>
              <span class="pay-note">Do not close this window</span>
            </div>`;

          setTimeout(() => {
            // Resolve first, then close — closeModal fires onClose, and we
            // don't want that reading as a cancellation.
            finish({ mode });
            closeModal();
          }, PROCESSING_MS);
        });
      },
    });
  });
}
