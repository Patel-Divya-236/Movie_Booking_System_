/**
 * Pricing rules — server-side only.
 *
 * The browser never decides what a booking costs. It sends the show and the
 * seat IDs; `computeBookingTotal` derives every rupee from the stored show
 * price and the seat layout. Any `totalPrice` in the request body is ignored.
 */

const { buildSeatMap } = require('./seatLayouts');

// Screen formats and what they add to the base ticket price.
const FORMATS = {
  '2D':       { label: '2D',       surcharge: 0 },
  '3D':       { label: '3D',       surcharge: 50 },
  '4DX':      { label: '4DX',      surcharge: 200 },
  'IMAX 2D':  { label: 'IMAX 2D',  surcharge: 120 },
  'IMAX 3D':  { label: 'IMAX 3D',  surcharge: 180 },
};

const FORMAT_IDS = Object.keys(FORMATS);

const CONVENIENCE_FEE_PER_TICKET = 30;
const GST_RATE = 0.18; // GST applies to the convenience fee, not the ticket
const MAX_SEATS_PER_BOOKING = 10;

/** Applied once when a show is created, so the listed price is the charged price. */
function applyFormatSurcharge(basePrices, format) {
  const extra = FORMATS[format] ? FORMATS[format].surcharge : 0;
  const out = {};
  for (const [tier, price] of Object.entries(basePrices || {})) {
    out[tier] = Number(price) + extra;
  }
  return out;
}

/**
 * Turn seat IDs into a priced, validated breakdown.
 * Throws on unknown seats, tiers the screen doesn't sell, duplicates, or
 * more seats than we allow in one transaction.
 */
function computeBookingTotal(seatIds, show) {
  if (!Array.isArray(seatIds) || seatIds.length === 0) {
    throw Object.assign(new Error('Select at least one seat'), { status: 400 });
  }
  if (seatIds.length > MAX_SEATS_PER_BOOKING) {
    throw Object.assign(
      new Error(`You can book at most ${MAX_SEATS_PER_BOOKING} seats at a time`),
      { status: 400 }
    );
  }
  if (new Set(seatIds).size !== seatIds.length) {
    throw Object.assign(new Error('Duplicate seats in request'), { status: 400 });
  }

  const seatMap = buildSeatMap(show.layoutId);
  const seats = seatIds.map(id => {
    const tier = seatMap[id];
    if (!tier) {
      throw Object.assign(new Error(`Seat ${id} does not exist on this screen`), { status: 400 });
    }
    const price = show.prices && show.prices[tier];
    if (typeof price !== 'number') {
      throw Object.assign(new Error(`No price configured for ${tier} seats`), { status: 500 });
    }
    return { id, tier, price };
  });

  const subtotal = seats.reduce((sum, s) => sum + s.price, 0);
  const convenienceFee = seats.length * CONVENIENCE_FEE_PER_TICKET;
  const gst = Math.round(convenienceFee * GST_RATE);
  const totalPrice = subtotal + convenienceFee + gst;

  return { seats, subtotal, convenienceFee, gst, totalPrice };
}

module.exports = {
  FORMATS,
  FORMAT_IDS,
  CONVENIENCE_FEE_PER_TICKET,
  GST_RATE,
  MAX_SEATS_PER_BOOKING,
  applyFormatSurcharge,
  computeBookingTotal,
};
