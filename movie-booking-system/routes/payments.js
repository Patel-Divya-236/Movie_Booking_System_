/**
 * Razorpay checkout.
 *
 * The flow, and why it has this shape:
 *
 *   POST /order   server prices the seats from stored data, places a HOLD on
 *                 each one, then asks Razorpay for an order
 *   (browser)     Razorpay Checkout collects the money
 *   POST /verify  signature is checked, holds become a real booking
 *
 * A hold exists because real payment takes time. Without one, two people can
 * pay for the same seat and the loser is charged for nothing. Holds expire
 * after SEAT_HOLD_MINUTES.
 *
 * Expiry is enforced on READ, not by DynamoDB TTL. TTL deletion is only
 * promised "typically within 48 hours", which is useless for releasing a seat
 * someone abandoned two minutes ago — TTL is garbage collection here, nothing
 * more.
 */

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { docClient, TABLES } = require('../db');
const { GetCommand, TransactWriteCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { authenticate } = require('../middleware/auth');
const { computeBookingTotal } = require('../config/pricing');
const { REQUIRE_EMAIL_VERIFICATION } = require('../config/catalog');
const payments = require('../services/payments');
const notify = require('../services/notify');

const router = express.Router();

const HOLD_MINUTES = Number(process.env.SEAT_HOLD_MINUTES) || 10;

/** Short, human-readable booking reference — easier to read out than a UUID. */
function makeBookingRef() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const bytes = crypto.randomBytes(6);
  let ref = '';
  for (const b of bytes) ref += alphabet[b % alphabet.length];
  return `CC-${ref}`;
}

/** Drop hold items we own. Best-effort: a stale hold expires by itself. */
async function releaseHold(showId, seatIds, holdId) {
  await Promise.allSettled(seatIds.map(seatId => docClient.send(new DeleteCommand({
    TableName: TABLES.SEAT_LOCKS,
    Key: { showId, seatId },
    ConditionExpression: 'holdId = :h',
    ExpressionAttributeValues: { ':h': holdId },
  }))));
}

/** GET /api/payments/key — the publishable key id, for Checkout. */
router.get('/key', (req, res) => {
  if (!payments.configured()) {
    return res.status(503).json({ error: 'Payment gateway is not configured' });
  }
  res.json({ key: payments.publicKey(), holdMinutes: HOLD_MINUTES });
});

/**
 * POST /api/payments/order   { showId, seats: ["A1"] }
 *
 * Note what the body does NOT contain: an amount. It is derived from the show
 * and the seat layout, exactly as the simulated flow already did. The previous
 * Razorpay attempt took `amount` from the body, so a crafted request could pay
 * one rupee for a recliner.
 */
router.post('/order', authenticate, async (req, res, next) => {
  try {
    if (REQUIRE_EMAIL_VERIFICATION && !req.user.emailVerified) {
      return res.status(403).json({
        error: 'Please verify your email address before booking',
        needsVerification: true,
      });
    }

    const { showId, seats } = req.body;
    if (!showId) return res.status(400).json({ error: 'showId is required' });

    const showRes = await docClient.send(new GetCommand({ TableName: TABLES.SHOWS, Key: { showId } }));
    const show = showRes.Item;
    if (!show) return res.status(404).json({ error: 'Show not found' });
    if (new Date(show.startsAt).getTime() <= Date.now()) {
      return res.status(409).json({ error: 'This show has already started' });
    }

    // Throws a 400 for unknown seats, duplicates, or too many seats.
    const priced = computeBookingTotal(seats, show);

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expiresAt = new Date(now + HOLD_MINUTES * 60_000).toISOString();
    const holdId = uuidv4();

    // Reserve every seat or none. The condition lets a hold take a seat that
    // is free, or one whose previous hold has lapsed — but never a real
    // booking, and never someone else's live hold.
    try {
      await docClient.send(new TransactWriteCommand({
        TransactItems: priced.seats.map(seat => ({
          Put: {
            TableName: TABLES.SEAT_LOCKS,
            Item: {
              showId,
              seatId: seat.id,
              status: 'hold',
              holdId,
              userId: req.user.userId,
              tier: seat.tier,
              lockedAt: nowIso,
              expiresAt,
              // For DynamoDB TTL, if it is ever switched on. Cleanup only —
              // correctness comes from the expiresAt comparison.
              ttl: Math.floor((now + HOLD_MINUTES * 60_000) / 1000),
            },
            ConditionExpression:
              'attribute_not_exists(showId) OR (#st = :hold AND expiresAt <= :now)',
            ExpressionAttributeNames: { '#st': 'status' },
            ExpressionAttributeValues: { ':hold': 'hold', ':now': nowIso },
          },
        })),
      }));
    } catch (err) {
      if (err.name === 'TransactionCanceledException') {
        return res.status(409).json({ error: 'Someone just took one of those seats. Please pick again.' });
      }
      throw err;
    }

    let order;
    try {
      order = await payments.createOrder({
        amountRupees: priced.totalPrice,
        receipt: holdId.slice(0, 34),
        notes: {
          showId,
          seats: priced.seats.map(s => s.id).join(','),
          userId: req.user.userId,
        },
      });
    } catch (err) {
      // The gateway refused, so let the seats go rather than holding them for
      // ten minutes on behalf of a checkout that can never complete.
      await releaseHold(showId, priced.seats.map(s => s.id), holdId);
      throw err;
    }

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: payments.publicKey(),
      holdId,
      expiresAt,
      holdMinutes: HOLD_MINUTES,
      breakdown: {
        seats: priced.seats,
        subtotal: priced.subtotal,
        convenienceFee: priced.convenienceFee,
        gst: priced.gst,
        totalPrice: priced.totalPrice,
      },
      show: {
        showId,
        movieTitle: show.movieTitle,
        theatreName: show.theatreName,
        date: show.date,
        time: show.time,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payments/release  { showId, seats, holdId }
 * Called when the user closes Checkout, so the seats come back immediately
 * instead of sitting out the full hold.
 */
router.post('/release', authenticate, async (req, res, next) => {
  try {
    const { showId, seats, holdId } = req.body;
    if (!showId || !holdId || !Array.isArray(seats)) {
      return res.status(400).json({ error: 'showId, seats and holdId are required' });
    }
    await releaseHold(showId, seats, holdId);
    res.json({ message: 'Seats released' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payments/verify
 * { razorpay_order_id, razorpay_payment_id, razorpay_signature, holdId, showId, seats }
 *
 * The signature check is what proves Razorpay took the money. The previous
 * attempt had no verification at all, so the booking endpoint could simply be
 * called directly without paying.
 */
router.post('/verify', authenticate, async (req, res, next) => {
  try {
    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      holdId, showId, seats,
    } = req.body;

    if (!payments.verifySignature({ orderId, paymentId, signature })) {
      return res.status(400).json({ error: 'Payment could not be verified' });
    }

    // Ask Razorpay directly rather than trusting anything echoed back. A
    // correctly-signed reference to a payment that does not exist is a client
    // problem, not a server fault, so it must not surface as a 500.
    let payment = null;
    try {
      payment = await payments.fetchPayment(paymentId);
    } catch (err) {
      const why = (err.error && err.error.description) || err.message;
      return res.status(400).json({ error: `Payment could not be confirmed with the gateway (${why})` });
    }

    if (!payment || !['captured', 'authorized'].includes(payment.status)) {
      return res.status(400).json({
        error: `Payment is not complete (status: ${payment ? payment.status : 'unknown'})`,
      });
    }

    const showRes = await docClient.send(new GetCommand({ TableName: TABLES.SHOWS, Key: { showId } }));
    const show = showRes.Item;
    if (!show) return res.status(404).json({ error: 'Show not found' });

    const priced = computeBookingTotal(seats, show);

    // What was taken must match what these seats cost. A mismatch means the
    // order was built for something else.
    if (Math.round(priced.totalPrice * 100) !== payment.amount) {
      return res.status(409).json({ error: 'Paid amount does not match the seats — please contact support' });
    }

    const bookingId = uuidv4();
    const bookingRef = makeBookingRef();
    const bookedAt = new Date().toISOString();

    const booking = {
      bookingId,
      bookingRef,
      showId,

      userId: req.user.userId,
      userName: req.user.name,
      userEmail: req.user.email,

      // Denormalized so a ticket renders without extra reads.
      movieId: show.movieId,
      movieTitle: show.movieTitle,
      posterUrl: show.posterUrl || '',
      language: show.language,
      certificate: show.certificate,
      theatreId: show.theatreId,
      theatreName: show.theatreName,
      area: show.area || '',
      city: show.city,
      screenName: show.screenName,
      format: show.format,
      date: show.date,
      time: show.time,
      startsAt: show.startsAt,

      seats: priced.seats,
      seatIds: priced.seats.map(s => s.id),
      subtotal: priced.subtotal,
      convenienceFee: priced.convenienceFee,
      gst: priced.gst,
      totalPrice: priced.totalPrice,

      payment: {
        provider: 'razorpay',
        orderId,
        paymentId,
        method: payment.method || null,
        mode: payment.method || 'razorpay',
        status: payment.status,
        simulated: false,
        testMode: String(process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_test_'),
        paidAt: bookedAt,
      },

      status: 'confirmed',
      bookedAt,
    };

    // Promote each hold to a booked lock and write the booking, atomically.
    // The condition ties it to OUR hold, so a seat whose hold lapsed and was
    // retaken fails here rather than being silently double-sold.
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        ...priced.seats.map(seat => ({
          Put: {
            TableName: TABLES.SEAT_LOCKS,
            Item: {
              showId,
              seatId: seat.id,
              status: 'booked',
              bookingId,
              tier: seat.tier,
              lockedAt: bookedAt,
            },
            ConditionExpression: 'attribute_not_exists(showId) OR holdId = :h',
            ExpressionAttributeValues: { ':h': holdId },
          },
        })),
        { Put: { TableName: TABLES.BOOKINGS, Item: booking } },
      ],
    }));

    notify.sendBookingNotifications(booking).catch(err => {
      console.error(`✉ booking email failed for ${bookingRef}:`, err.message);
    });

    res.status(201).json({ bookingId, bookingRef, booking });
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      return res.status(409).json({
        error: 'Your hold expired and the seats were taken. The payment will be refunded — please contact support.',
      });
    }
    next(err);
  }
});

module.exports = router;
