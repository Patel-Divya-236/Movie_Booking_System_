/**
 * Razorpay payment gateway.
 *
 * Two rules, both learned from the previous attempt at this (see the removed
 * code in commit c1efede):
 *
 *   1. The amount is computed here from the stored show and seat layout. The
 *      old version took `amount` straight from the request body, so a crafted
 *      call could pay one rupee for a recliner.
 *
 *   2. Every payment is verified by signature before a booking exists. The old
 *      version created orders and never checked that money arrived, so the
 *      booking endpoint could simply be called directly.
 *
 * Test mode throughout: keys are rzp_test_*, no real money moves.
 */

const crypto = require('crypto');
const Razorpay = require('razorpay');

function configured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

let client = null;
function getClient() {
  if (!configured()) return null;
  if (!client) {
    client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return client;
}

/**
 * Create an order for an amount the caller has already computed from stored
 * data. Razorpay works in paise, so rupees are multiplied here in one place
 * rather than at every call site.
 */
async function createOrder({ amountRupees, receipt, notes }) {
  const rzp = getClient();
  if (!rzp) throw Object.assign(new Error('Payment gateway is not configured'), { status: 503 });

  return rzp.orders.create({
    amount: Math.round(amountRupees * 100),
    currency: 'INR',
    receipt: String(receipt).slice(0, 40),
    notes: notes || {},
  });
}

/**
 * Is this callback genuinely from Razorpay?
 *
 * Razorpay signs `order_id|payment_id` with the key secret. Recomputing that
 * HMAC and comparing is the entire security model — without it the client
 * could claim any payment succeeded.
 *
 * timingSafeEqual rather than === so the comparison cannot be probed a byte at
 * a time.
 */
function verifySignature({ orderId, paymentId, signature }) {
  if (!configured() || !orderId || !paymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Ask Razorpay what it thinks the payment is, rather than trusting the client. */
async function fetchPayment(paymentId) {
  const rzp = getClient();
  if (!rzp) return null;
  return rzp.payments.fetch(paymentId);
}

module.exports = { configured, createOrder, verifySignature, fetchPayment, publicKey: () => process.env.RAZORPAY_KEY_ID || null };
