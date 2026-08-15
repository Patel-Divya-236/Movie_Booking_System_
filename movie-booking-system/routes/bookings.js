const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { docClient, TABLES } = require('../db');
const {
  GetCommand, QueryCommand, ScanCommand, TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { authenticate } = require('../middleware/auth');
const { computeBookingTotal } = require('../config/pricing');
const { CANCELLATION_CUTOFF_MINUTES, REQUIRE_EMAIL_VERIFICATION } = require('../config/catalog');
const ticket = require('../services/ticket');
const notify = require('../services/notify');

const router = express.Router();

const PAYMENT_MODES = ['upi', 'card', 'netbanking', 'wallet'];

/** Short, human-readable booking reference — easier to read out than a UUID. */
function makeBookingRef() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const bytes = crypto.randomBytes(6);
  let ref = '';
  for (const b of bytes) ref += alphabet[b % alphabet.length];
  return `CC-${ref}`;
}

async function getBookingById(bookingId) {
  const res = await docClient.send(new GetCommand({
    TableName: TABLES.BOOKINGS,
    Key: { bookingId },
  }));
  return res.Item;
}

/** Owner or admin only. */
function canAccess(booking, user) {
  return user.role === 'admin' || booking.userId === user.userId;
}

// ---------------------------------------------------------------- reads

/** GET /api/bookings/seats/:showId — which seats are taken. Public. */
router.get('/seats/:showId', async (req, res, next) => {
  try {
    const locks = await docClient.send(new QueryCommand({
      TableName: TABLES.SEAT_LOCKS,
      KeyConditionExpression: 'showId = :s',
      ExpressionAttributeValues: { ':s': req.params.showId },
      ProjectionExpression: 'seatId',
    }));
    res.json({ bookedSeats: (locks.Items || []).map(l => l.seatId) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/bookings — the user's bookings, or everything for an admin. */
router.get('/', authenticate, async (req, res, next) => {
  try {
    let items;
    if (req.user.role === 'admin') {
      // Admin reporting genuinely needs the whole table.
      const res_ = await docClient.send(new ScanCommand({ TableName: TABLES.BOOKINGS }));
      items = res_.Items || [];
    } else {
      const res_ = await docClient.send(new QueryCommand({
        TableName: TABLES.BOOKINGS,
        IndexName: 'userId-bookedAt-index',
        KeyConditionExpression: 'userId = :u',
        ExpressionAttributeValues: { ':u': req.user.userId },
        ScanIndexForward: false, // newest first, done by the index
      }));
      items = res_.Items || [];
    }

    if (req.user.role === 'admin') {
      items.sort((a, b) => new Date(b.bookedAt) - new Date(a.bookedAt));
    }
    res.json(items);
  } catch (err) {
    next(err);
  }
});

/** GET /api/bookings/:id */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const booking = await getBookingById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!canAccess(booking, req.user)) return res.status(403).json({ error: 'Not your booking' });
    res.json(booking);
  } catch (err) {
    next(err);
  }
});

/** GET /api/bookings/:id/ticket — the PDF, same one that gets emailed. */
router.get('/:id/ticket', authenticate, async (req, res, next) => {
  try {
    const booking = await getBookingById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!canAccess(booking, req.user)) return res.status(403).json({ error: 'Not your booking' });

    const pdf = await ticket.generateTicketPdf(booking);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="CineCloud-${booking.bookingRef}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- create

/**
 * POST /api/bookings
 * Body: { showId, seats: ["A1","A2"], paymentMode }
 *
 * The client sends no prices. Everything is derived from the stored show and
 * the seat layout, then the seats and the booking are written in a single
 * DynamoDB transaction — one conditional Put per seat means a seat can only
 * ever be claimed once, however many people click at the same instant.
 */
router.post('/', authenticate, async (req, res, next) => {
  try {
    // Off while SES is sandboxed — see REQUIRE_EMAIL_VERIFICATION in
    // config/catalog.js for why enforcing it there would lock users out.
    if (REQUIRE_EMAIL_VERIFICATION && !req.user.emailVerified) {
      return res.status(403).json({
        error: 'Please verify your email address before booking',
        needsVerification: true,
      });
    }

    const { showId, seats, paymentMode } = req.body;
    if (!showId) return res.status(400).json({ error: 'showId is required' });

    const showRes = await docClient.send(new GetCommand({
      TableName: TABLES.SHOWS,
      Key: { showId },
    }));
    const show = showRes.Item;
    if (!show) return res.status(404).json({ error: 'Show not found' });

    if (new Date(show.startsAt).getTime() <= Date.now()) {
      return res.status(409).json({ error: 'This show has already started' });
    }

    const mode = PAYMENT_MODES.includes(paymentMode) ? paymentMode : 'upi';

    // Throws a 400 for unknown seats, duplicates, or too many seats.
    const priced = computeBookingTotal(seats, show);

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

      // Simulated — no gateway is contacted and no card data is collected.
      payment: {
        paymentId: `PAY_${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
        mode,
        status: 'paid',
        simulated: true,
        paidAt: bookedAt,
      },

      status: 'confirmed',
      bookedAt,
    };

    const transactItems = [
      ...priced.seats.map(seat => ({
        Put: {
          TableName: TABLES.SEAT_LOCKS,
          Item: {
            showId,
            seatId: seat.id,
            bookingId,
            tier: seat.tier,
            lockedAt: bookedAt,
          },
          // The whole point: if this seat already exists, the transaction dies.
          ConditionExpression: 'attribute_not_exists(showId) AND attribute_not_exists(seatId)',
        },
      })),
      { Put: { TableName: TABLES.BOOKINGS, Item: booking } },
    ];

    try {
      await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (err) {
      if (err.name === 'TransactionCanceledException') {
        // CancellationReasons lines up with TransactItems, so we can name the
        // exact seats someone else got to first.
        const conflicts = (err.CancellationReasons || [])
          .map((reason, i) => (reason.Code === 'ConditionalCheckFailed' ? priced.seats[i]?.id : null))
          .filter(Boolean);

        return res.status(409).json({
          error: conflicts.length
            ? `Just gone — ${conflicts.join(', ')} ${conflicts.length > 1 ? 'were' : 'was'} booked by someone else`
            : 'Those seats are no longer available',
          conflictSeats: conflicts,
        });
      }
      throw err;
    }

    res.status(201).json({ message: 'Booking confirmed', bookingId, bookingRef, booking });

    // Ticket email and admin alert happen after the response — a slow or
    // misconfigured SES must never delay or fail a confirmed booking.
    notify.sendBookingNotifications(booking).catch(err => {
      console.warn('Notification failed (booking is unaffected):', err.message);
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- cancel

/**
 * DELETE /api/bookings/:id
 * Releases the seats and marks the booking cancelled, atomically.
 */
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const booking = await getBookingById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!canAccess(booking, req.user)) {
      return res.status(403).json({ error: 'Not your booking' });
    }
    if (booking.status === 'cancelled') {
      return res.status(409).json({ error: 'This booking is already cancelled' });
    }

    // Admins can override the cutoff; users can't cancel a show that's about
    // to start (or has already finished).
    const minutesToShow = (new Date(booking.startsAt).getTime() - Date.now()) / 60000;
    if (req.user.role !== 'admin' && minutesToShow < CANCELLATION_CUTOFF_MINUTES) {
      return res.status(409).json({
        error: minutesToShow < 0
          ? 'This show has already started — it can no longer be cancelled'
          : `Cancellations close ${CANCELLATION_CUTOFF_MINUTES} minutes before showtime`,
      });
    }

    const seatIds = booking.seatIds || (booking.seats || []).map(s => s.id || s);

    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        ...seatIds.map(seatId => ({
          Delete: {
            TableName: TABLES.SEAT_LOCKS,
            Key: { showId: booking.showId, seatId },
          },
        })),
        {
          Update: {
            TableName: TABLES.BOOKINGS,
            Key: { bookingId: booking.bookingId },
            UpdateExpression: 'SET #s = :cancelled, cancelledAt = :now',
            // Guards against two cancel clicks racing each other: the second
            // one finds the status already changed and the whole thing aborts,
            // so seats can't be released twice.
            ConditionExpression: '#s = :confirmed',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':cancelled': 'cancelled',
              ':confirmed': 'confirmed',
              ':now': new Date().toISOString(),
            },
          },
        },
      ],
    }));

    res.json({ message: 'Booking cancelled — those seats are available again' });
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      return res.status(409).json({ error: 'This booking was already cancelled' });
    }
    next(err);
  }
});

module.exports = router;
