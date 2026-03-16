const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../db');
const { PutCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/bookings/seats/:movieId/:showtime — get booked seats for a showtime
router.get('/seats/:movieId/:showtime', async (req, res) => {
  try {
    const { movieId, showtime } = req.params;
    const result = await docClient.send(new ScanCommand({
      TableName: 'MovieBooking_Bookings',
      FilterExpression: 'movieId = :m AND showtime = :s',
      ExpressionAttributeValues: { ':m': movieId, ':s': decodeURIComponent(showtime) },
    }));

    const bookedSeats = [];
    if (result.Items) {
      result.Items.forEach(booking => {
        if (booking.seats) bookedSeats.push(...booking.seats);
      });
    }
    res.json({ bookedSeats });
  } catch (err) {
    console.error('Get seats error:', err);
    res.status(500).json({ error: 'Failed to fetch seat availability' });
  }
});

// POST /api/bookings — create a booking
router.post('/', authenticate, async (req, res) => {
  try {
    const { movieId, movieTitle, showtime, seats, totalPrice } = req.body;
    if (!movieId || !showtime || !seats || seats.length === 0) {
      return res.status(400).json({ error: 'Movie, showtime, and seats are required' });
    }

    // Check for double booking
    const existing = await docClient.send(new ScanCommand({
      TableName: 'MovieBooking_Bookings',
      FilterExpression: 'movieId = :m AND showtime = :s',
      ExpressionAttributeValues: { ':m': movieId, ':s': showtime },
    }));

    const alreadyBooked = [];
    if (existing.Items) {
      existing.Items.forEach(b => {
        if (b.seats) alreadyBooked.push(...b.seats);
      });
    }

    const conflict = seats.filter(s => alreadyBooked.includes(s));
    if (conflict.length > 0) {
      return res.status(409).json({
        error: `Seats already booked: ${conflict.join(', ')}`,
        conflictSeats: conflict,
      });
    }

    const bookingId = uuidv4();
    await docClient.send(new PutCommand({
      TableName: 'MovieBooking_Bookings',
      Item: {
        bookingId,
        userId: req.user.userId,
        userName: req.user.name,
        userEmail: req.user.email,
        movieId,
        movieTitle: movieTitle || '',
        showtime,
        seats,
        totalPrice: Number(totalPrice) || 0,
        status: 'confirmed',
        bookedAt: new Date().toISOString(),
      },
    }));

    // Try to send SES notification (non-blocking, won't fail the booking)
    try {
      const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
      const ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
      if (process.env.SES_FROM_EMAIL && process.env.SES_FROM_EMAIL !== 'your-verified-email@example.com') {
        await ses.send(new SendEmailCommand({
          Source: process.env.SES_FROM_EMAIL,
          Destination: { ToAddresses: [req.user.email] },
          Message: {
            Subject: { Data: `Booking Confirmed — ${movieTitle}` },
            Body: {
              Text: {
                Data: `Hi ${req.user.name},\n\nYour booking is confirmed!\n\nMovie: ${movieTitle}\nShowtime: ${showtime}\nSeats: ${seats.join(', ')}\nTotal: ₹${totalPrice}\n\nBooking ID: ${bookingId}\n\nEnjoy the show! 🎬`,
              },
            },
          },
        }));
      }
    } catch (sesErr) {
      console.log('SES notification skipped (not configured):', sesErr.message);
    }

    res.status(201).json({ message: 'Booking confirmed!', bookingId });
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ error: 'Booking failed' });
  }
});

// GET /api/bookings — get user's bookings (or all if admin)
router.get('/', authenticate, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'admin') {
      result = await docClient.send(new ScanCommand({
        TableName: 'MovieBooking_Bookings',
      }));
    } else {
      result = await docClient.send(new ScanCommand({
        TableName: 'MovieBooking_Bookings',
        FilterExpression: 'userId = :u',
        ExpressionAttributeValues: { ':u': req.user.userId },
      }));
    }

    const items = (result.Items || []).sort((a, b) =>
      new Date(b.bookedAt) - new Date(a.bookedAt)
    );
    res.json(items);
  } catch (err) {
    console.error('Get bookings error:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

module.exports = router;
