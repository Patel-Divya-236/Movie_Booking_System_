const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../db');
const { PutCommand, ScanCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { authenticate } = require('../middleware/auth');
const Razorpay = require('razorpay');

const router = express.Router();

// GET /api/bookings/razorpay-key
router.get('/razorpay-key', (req, res) => {
  res.json({ key: process.env.RAZORPAY_KEY_ID || 'rzp_test_O00dof1R8jO7k2' });
});

// POST /api/bookings/razorpay-order
router.post('/razorpay-order', authenticate, async (req, res) => {
  try {
    const instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_O00dof1R8jO7k2',
      key_secret: process.env.RAZORPAY_KEY_SECRET || 'U8qMg7uYxM2sXzH3K5' // Demo test secret fallback
    });

    const options = {
      amount: req.body.amount, // amount in the smallest currency unit (paise)
      currency: "INR",
      receipt: "receipt_order_" + Date.now(),
    };

    const order = await instance.orders.create(options);
    if (!order) return res.status(500).json({ error: "Some error occured" });
    res.json(order);
  } catch (error) {
    console.error('Razorpay order creation error:', error);
    res.status(500).json({ error: error.message || 'Error creating order' });
  }
});

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
      const fromEmail = process.env.SES_FROM_EMAIL;
      const adminEmail = process.env.ADMIN_EMAIL || fromEmail; // Notifications go to admin

      if (fromEmail && fromEmail !== 'your-verified-email@example.com') {
        // Send email to the Customer (Ticket Receipt)
        await ses.send(new SendEmailCommand({
          Source: fromEmail,
          Destination: { ToAddresses: [req.user.email] },
          Message: {
            Subject: { Data: `Booking Confirmed — ${movieTitle}` },
            Body: {
              Text: {
                Data: `Hi ${req.user.name},\n\nYour payment is successful and your ticket is confirmed!\n\nMovie: ${movieTitle}\nShowtime: ${showtime}\nSeats: ${seats.join(', ')}\nTotal Paid: ₹${totalPrice}\n\nBooking ID: ${bookingId}\n\nEnjoy the show! 🎬`,
              },
            },
          },
        }));

        // Send email to the Admin (Credit Notification)
        if (adminEmail && adminEmail !== 'your-admin-email@example.com') {
          await ses.send(new SendEmailCommand({
            Source: fromEmail,
            Destination: { ToAddresses: [adminEmail] },
            Message: {
              Subject: { Data: `[ADMIN] 💰 Credit Received! New Booking for ${movieTitle}` },
              Body: {
                Text: {
                  Data: `Admin Notification:\n\nPayment Received: ₹${totalPrice}\nCustomer: ${req.user.name} (${req.user.email})\nMovie: ${movieTitle}\nShowtime: ${showtime}\nSeats: ${seats.join(', ')}\nBooking ID: ${bookingId}\n\nLogged at: ${new Date().toISOString()}`,
                },
              },
            },
          }));
        }
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

// DELETE /api/bookings/:id — cancel a booking
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const bookingId = req.params.id;

    // First, get the booking to ensure it belongs to the user (unless admin)
    const result = await docClient.send(new ScanCommand({
      TableName: 'MovieBooking_Bookings',
      FilterExpression: 'bookingId = :b',
      ExpressionAttributeValues: { ':b': bookingId },
    }));

    const booking = result.Items?.[0];
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (req.user.role !== 'admin' && booking.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorized to cancel this booking' });
    }

    // Delete it
    await docClient.send(new DeleteCommand({
      TableName: 'MovieBooking_Bookings',
      Key: { bookingId },
    }));

    res.json({ message: 'Booking cancelled successfully. Seats are now available.' });
  } catch (err) {
    console.error('Cancel booking error:', err);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

module.exports = router;
