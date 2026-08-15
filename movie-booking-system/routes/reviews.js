/**
 * User ratings and reviews.
 *
 * Two rules make the number mean something:
 *
 *   1. Only someone who booked the film, on a show that has already played,
 *      may rate it. Anyone can sign up; not anyone can have watched.
 *   2. One review per person per film — enforced by the table's composite key
 *      rather than by checking first, so a double submit overwrites instead of
 *      stacking.
 *
 * The average is kept as ratingSum/ratingCount on the movie record and updated
 * in the same transaction as the review write, so the listing page never has
 * to read this table. See setup-tables.js for why.
 */

const express = require('express');
const { docClient, TABLES, queryAll } = require('../db');
const {
  GetCommand, QueryCommand, TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const MIN_RATING = 1;
const MAX_RATING = 5;
const MAX_COMMENT = 600;
/** Below this, one enthusiast can swing the average, so we say so in the UI. */
const CONFIDENCE_THRESHOLD = 5;

/** Average to one decimal, or null when there is nothing to average. */
function average(sum, count) {
  if (!count) return null;
  return Number((sum / count).toFixed(1));
}

/**
 * Has this user watched this film?
 *
 * A booking counts only if it is not cancelled and its show date is in the
 * past — rating a film you have a ticket for but have not seen yet is exactly
 * the hole this closes.
 */
async function findEligibleBooking(userId, movieId) {
  const today = new Date().toISOString().slice(0, 10);

  const bookings = await queryAll(QueryCommand, {
    TableName: TABLES.BOOKINGS,
    IndexName: 'userId-bookedAt-index',
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': userId },
    ProjectionExpression: 'bookingId, movieId, #d, #s',
    ExpressionAttributeNames: { '#d': 'date', '#s': 'status' },
  });

  return bookings.find(b =>
    b.movieId === movieId && b.status !== 'cancelled' && b.date < today) || null;
}

/**
 * GET /api/reviews/:movieId
 *
 * Public. Returns the summary, the most recent reviews, and — when a token is
 * present — whether this viewer may write one and what they said last time.
 */
router.get('/:movieId', optionalAuth, async (req, res, next) => {
  try {
    const { movieId } = req.params;

    const movieRes = await docClient.send(new GetCommand({
      TableName: TABLES.MOVIES,
      Key: { movieId },
      ProjectionExpression: 'movieId, ratingSum, ratingCount, rating',
    }));
    if (!movieRes.Item) {
      return res.status(404).json({ error: 'No such movie' });
    }

    const sum = movieRes.Item.ratingSum || 0;
    const count = movieRes.Item.ratingCount || 0;

    const reviews = await queryAll(QueryCommand, {
      TableName: TABLES.REVIEWS,
      KeyConditionExpression: 'movieId = :m',
      ExpressionAttributeValues: { ':m': movieId },
    });

    // Newest first. Sorting here rather than in the key schema keeps the
    // composite key doing its real job — one review per person.
    reviews.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    let mine = null;
    let canReview = false;
    let reason = 'Sign in to rate this film';

    if (req.user) {
      mine = reviews.find(r => r.userId === req.user.userId) || null;
      const booking = await findEligibleBooking(req.user.userId, movieId);
      canReview = Boolean(booking);
      reason = booking
        ? ''
        : 'Only people who have watched this film here can rate it';
    }

    res.json({
      summary: {
        user: average(sum, count),
        count,
        // Kept separate on purpose: TMDB is out of 10 and ours is out of 5, so
        // the UI labels each with its own scale rather than blending them.
        tmdb: movieRes.Item.rating ?? null,
        provisional: count > 0 && count < CONFIDENCE_THRESHOLD,
      },
      reviews: reviews.slice(0, 20).map(r => ({
        userId: r.userId,
        userName: r.userName,
        rating: r.rating,
        comment: r.comment || '',
        createdAt: r.createdAt,
      })),
      mine,
      canReview,
      reason,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reviews/:movieId   { rating: 1..5, comment?: string }
 *
 * Writing the review and moving the movie's aggregate happen in one
 * TransactWriteItems: a partial write here would leave the average permanently
 * wrong with nothing to reconcile it against.
 */
router.post('/:movieId', authenticate, async (req, res, next) => {
  try {
    const { movieId } = req.params;
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || '').trim().slice(0, MAX_COMMENT);

    if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
      return res.status(400).json({ error: `Rating must be a whole number from ${MIN_RATING} to ${MAX_RATING}` });
    }

    const movieRes = await docClient.send(new GetCommand({
      TableName: TABLES.MOVIES, Key: { movieId }, ProjectionExpression: 'movieId',
    }));
    if (!movieRes.Item) return res.status(404).json({ error: 'No such movie' });

    const booking = await findEligibleBooking(req.user.userId, movieId);
    if (!booking) {
      return res.status(403).json({
        error: 'You can only rate a film you have booked and already watched here',
      });
    }

    // What they said before, if anything — the aggregate moves by the
    // difference, not by the new value.
    const existingRes = await docClient.send(new GetCommand({
      TableName: TABLES.REVIEWS,
      Key: { movieId, userId: req.user.userId },
    }));
    const existing = existingRes.Item || null;

    const delta = existing ? rating - existing.rating : rating;
    const countDelta = existing ? 0 : 1;

    const now = new Date().toISOString();

    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLES.REVIEWS,
            Item: {
              movieId,
              userId: req.user.userId,
              userName: req.user.name || 'CineCloud user',
              rating,
              comment,
              bookingId: booking.bookingId,
              createdAt: existing ? existing.createdAt : now,
              updatedAt: now,
              source: 'user',
            },
            // Guards the read-then-write above: if a concurrent request changed
            // the rating between our Get and this Put, the condition fails and
            // the aggregate is never moved by a stale delta.
            ...(existing
              ? {
                  ConditionExpression: 'rating = :old',
                  ExpressionAttributeValues: { ':old': existing.rating },
                }
              : {
                  ConditionExpression: 'attribute_not_exists(movieId)',
                }),
          },
        },
        {
          Update: {
            TableName: TABLES.MOVIES,
            Key: { movieId },
            UpdateExpression: 'ADD ratingSum :d, ratingCount :c',
            ExpressionAttributeValues: { ':d': delta, ':c': countDelta },
          },
        },
      ],
    }));

    const after = await docClient.send(new GetCommand({
      TableName: TABLES.MOVIES,
      Key: { movieId },
      ProjectionExpression: 'ratingSum, ratingCount',
    }));

    res.status(existing ? 200 : 201).json({
      message: existing ? 'Your rating was updated' : 'Thanks for rating',
      summary: {
        user: average(after.Item.ratingSum || 0, after.Item.ratingCount || 0),
        count: after.Item.ratingCount || 0,
      },
    });
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      return res.status(409).json({ error: 'That rating was just changed elsewhere — try again' });
    }
    next(err);
  }
});

module.exports = router;
