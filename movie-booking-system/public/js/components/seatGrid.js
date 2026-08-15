/**
 * Seat grid.
 *
 * Renders straight from the layout the server sent, so the grid the user
 * clicks is the grid the server validates against. Each tier keeps its own
 * colour and silhouette in every state — including while selected, which the
 * previous version lost because its selected/booked rules used !important.
 */

import { html, raw, rupees } from '../dom.js';

/** Cheapest (nearest the screen) to most expensive (back row). */
const TIER_META = {
  normal:    { label: 'Normal',    icon: '🪑' },
  executive: { label: 'Executive', icon: '💺' },
  premium:   { label: 'Premium',   icon: '🛋️' },
  recliner:  { label: 'Recliner',  icon: '🛏️' },
};

function seatMarkup(seatId, tier, { booked, selected }) {
  const classes = ['seat', `seat--${tier}`];
  if (booked) classes.push('is-booked');
  else if (selected) classes.push('is-selected');

  const label = booked ? `${seatId}, already booked` : `${seatId}, ${TIER_META[tier]?.label || tier}`;

  return html`<button
    type="button"
    class="${classes.join(' ')}"
    data-seat="${seatId}"
    data-tier="${tier}"
    ${raw(booked ? 'disabled aria-disabled="true"' : '')}
    aria-pressed="${selected ? 'true' : 'false'}"
    aria-label="${label}"
    title="${label}"
  >${seatId.replace(/^[A-Z]+/, '')}</button>`;
}

function rowMarkup(row, section, { bookedSet, selectedSet }) {
  const aisles = new Set(section.aislesAfter || []);
  const cells = [];

  for (let col = 1; col <= section.cols; col++) {
    const seatId = `${row}${col}`;
    cells.push(seatMarkup(seatId, section.tier, {
      booked: bookedSet.has(seatId),
      selected: selectedSet.has(seatId),
    }));
    if (aisles.has(col) && col !== section.cols) {
      cells.push('<span class="seat-aisle" aria-hidden="true"></span>');
    }
  }

  return html`
    <div class="seat-row">
      <span class="seat-row-label" aria-hidden="true">${row}</span>
      <div class="seat-row-seats">${raw(cells.join(''))}</div>
      <span class="seat-row-label" aria-hidden="true">${row}</span>
    </div>`;
}

/**
 * @param {object}   layout        from GET /api/shows/:id
 * @param {object}   prices        show.prices, keyed by tier
 * @param {string[]} bookedSeats
 * @param {object[]} selectedSeats [{ id }]
 */
export function renderSeatGrid({ layout, prices = {}, bookedSeats = [], selectedSeats = [] }) {
  const bookedSet = new Set(bookedSeats);
  const selectedSet = new Set(selectedSeats.map(s => s.id));

  const sections = layout.sections.map(section => {
    const meta = TIER_META[section.tier] || { label: section.tier, icon: '💺' };
    const price = prices[section.tier];

    return html`
      <section class="seat-section seat-section--${section.tier}">
        <header class="seat-section-head">
          <span class="seat-section-name">${meta.icon} ${section.label || meta.label}</span>
          <span class="seat-section-price">${price ? rupees(price) : ''}</span>
        </header>
        <div class="seat-rows">
          ${raw(section.rows.map(row => rowMarkup(row, section, { bookedSet, selectedSet })).join(''))}
        </div>
      </section>`;
  }).join('');

  // Only show tiers this screen actually has — Luxe has no recliners.
  const tiersPresent = [...new Set(layout.sections.map(s => s.tier))];

  return html`
    <div class="seat-area">
      <div class="screen-wrap">
        <div class="screen-curve"></div>
        <div class="screen-caption">All eyes this way</div>
      </div>

      <div class="seat-scroll">
        <div class="seat-map">${raw(sections)}</div>
      </div>

      <div class="seat-legend">
        <div class="legend-group">
          ${raw(tiersPresent.map(tier => html`
            <span class="legend-item">
              <span class="legend-swatch seat seat--${tier}" aria-hidden="true"></span>
              ${TIER_META[tier]?.label || tier}${prices[tier] ? ` · ${rupees(prices[tier])}` : ''}
            </span>`).join(''))}
        </div>
        <div class="legend-group">
          <span class="legend-item">
            <span class="legend-swatch seat seat--normal is-selected" aria-hidden="true"></span> Selected
          </span>
          <span class="legend-item">
            <span class="legend-swatch seat seat--normal is-booked" aria-hidden="true"></span> Booked
          </span>
        </div>
      </div>
    </div>`;
}

export { TIER_META };
