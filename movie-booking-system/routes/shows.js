const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { docClient, TABLES, queryAll } = require('../db');
const { PutCommand, GetCommand, DeleteCommand, QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { authenticate, adminOnly } = require('../middleware/auth');
const { LAYOUTS, totalSeats } = require('../config/seatLayouts');
const { FORMAT_IDS, applyFormatSurcharge } = require('../config/pricing');
const { BOOKING_WINDOW_DAYS } = require('../config/catalog');

const router = express.Router();

// ------------------------------------------------------------- helpers

function to12Hour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** How many seats are taken, per show. One COUNT query each, run in parallel. */
async function occupancyFor(shows) {
  const counts = await Promise.all(shows.map(async show => {
    const res = await docClient.send(new QueryCommand({
      TableName: TABLES.SEAT_LOCKS,
      KeyConditionExpression: 'showId = :s',
      ExpressionAttributeValues: { ':s': show.showId },
      Select: 'COUNT',
    }));
    return res.Count || 0;
  }));

  return shows.map((show, i) => {
    const total = totalSeats(show.layoutId);
    const booked = counts[i];
    const ratio = total ? booked / total : 0;
    return {
      ...show,
      seatsTotal: total,
      seatsBooked: booked,
      seatsLeft: total - booked,
      availability: booked >= total ? 'sold_out' : ratio >= 0.6 ? 'fast_filling' : 'available',
    };
  });
}

/** Shows that have already started shouldn't be bookable. */
function isUpcoming(show) {
  return new Date(show.startsAt).getTime() > Date.now();
}

// ------------------------------------------------------------- public reads

/**
 * GET /api/shows?movieId=&city=&date=
 * Returns showtimes grouped by theatre — the shape the showtimes page renders.
 */
router.get('/', async (req, res, next) => {
  try {
    const { movieId, city, date } = req.query;
    if (!city) return res.status(400).json({ error: 'city is required' });

    const day = date || new Date().toISOString().slice(0, 10);

    const items = movieId
      // Narrowest query available: this film, this city, this day.
      ? await queryAll(QueryCommand, {
          TableName: TABLES.SHOWS,
          IndexName: 'movieCity-date-index',
          KeyConditionExpression: 'movieCity = :mc AND begins_with(dateStart, :d)',
          ExpressionAttributeValues: { ':mc': `${movieId}#${city}`, ':d': day },
        })
      : await queryAll(QueryCommand, {
          TableName: TABLES.SHOWS,
          IndexName: 'city-date-index',
          KeyConditionExpression: 'city = :c AND begins_with(dateStart, :d)',
          ExpressionAttributeValues: { ':c': city, ':d': day },
        });

    const shows = items.filter(isUpcoming);
    const withOccupancy = await occupancyFor(shows);

    // Group by theatre, times ascending.
    const byTheatre = new Map();
    for (const show of withOccupancy) {
      if (!byTheatre.has(show.theatreId)) {
        byTheatre.set(show.theatreId, {
          theatreId: show.theatreId,
          theatreName: show.theatreName,
          area: show.area,
          city: show.city,
          shows: [],
        });
      }
      byTheatre.get(show.theatreId).shows.push(show);
    }

    const theatres = [...byTheatre.values()]
      .map(t => ({ ...t, shows: t.shows.sort((a, b) => a.time24.localeCompare(b.time24)) }))
      .sort((a, b) => a.theatreName.localeCompare(b.theatreName));

    res.json({ date: day, city, theatres });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shows/dates?movieId=&city=
 * Which of the next N days actually have shows — drives the date strip.
 */
router.get('/dates', async (req, res, next) => {
  try {
    const { movieId, city } = req.query;
    if (!city) return res.status(400).json({ error: 'city is required' });

    const today = new Date().toISOString().slice(0, 10);

    // Must page: a fortnight of showtimes for a city exceeds DynamoDB's 1MB
    // response cap, and a truncated read here silently shortens the date strip.
    const items = movieId
      ? await queryAll(QueryCommand, {
          TableName: TABLES.SHOWS,
          IndexName: 'movieCity-date-index',
          KeyConditionExpression: 'movieCity = :mc AND dateStart >= :d',
          ExpressionAttributeValues: { ':mc': `${movieId}#${city}`, ':d': `${today}#00:00` },
          ProjectionExpression: '#d, startsAt',
          ExpressionAttributeNames: { '#d': 'date' },
        })
      : await queryAll(QueryCommand, {
          TableName: TABLES.SHOWS,
          IndexName: 'city-date-index',
          KeyConditionExpression: 'city = :c AND dateStart >= :d',
          ExpressionAttributeValues: { ':c': city, ':d': `${today}#00:00` },
          ProjectionExpression: '#d, startsAt',
          ExpressionAttributeNames: { '#d': 'date' },
        });

    const dates = [...new Set(items.filter(isUpcoming).map(s => s.date))].sort();
    res.json({ dates });
  } catch (err) {
    next(err);
  }
});

/** GET /api/shows/:showId — the show plus which seats are already taken. */
router.get('/:showId', async (req, res, next) => {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: TABLES.SHOWS,
      Key: { showId: req.params.showId },
    }));
    if (!result.Item) return res.status(404).json({ error: 'Show not found' });

    const locks = await docClient.send(new QueryCommand({
      TableName: TABLES.SEAT_LOCKS,
      KeyConditionExpression: 'showId = :s',
      ExpressionAttributeValues: { ':s': req.params.showId },
      ProjectionExpression: 'seatId',
    }));

    res.json({
      show: result.Item,
      layout: LAYOUTS[result.Item.layoutId] || LAYOUTS.standard,
      bookedSeats: (locks.Items || []).map(l => l.seatId),
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------- admin writes

/** Build one show item from a theatre/screen/movie triple. */
function buildShow({ movie, theatre, screen, format, date, time24 }) {
  return {
    showId: uuidv4(),
    movieId: movie.movieId,
    movieTitle: movie.title,
    posterUrl: movie.posterUrl || '',
    language: movie.language,
    certificate: movie.certificate,
    duration: movie.duration,

    theatreId: theatre.theatreId,
    theatreName: theatre.name,
    city: theatre.city,
    area: theatre.area || '',
    screenId: screen.screenId,
    screenName: screen.name,
    layoutId: screen.layoutId,

    format,
    date,
    time: to12Hour(time24),
    time24,
    startsAt: new Date(`${date}T${time24}:00`).toISOString(),

    dateStart: `${date}#${time24}`,
    movieCity: `${movie.movieId}#${theatre.city}`,

    prices: applyFormatSurcharge(screen.basePrices, format),
    createdAt: new Date().toISOString(),
  };
}

async function loadMovieAndScreen(movieId, theatreId, screenId) {
  const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };

  const [movieRes, theatreRes] = await Promise.all([
    docClient.send(new GetCommand({ TableName: TABLES.MOVIES, Key: { movieId } })),
    docClient.send(new GetCommand({ TableName: TABLES.THEATRES, Key: { theatreId } })),
  ]);

  if (!movieRes.Item) fail('Movie not found', 404);
  if (!theatreRes.Item) fail('Theatre not found', 404);

  const screen = (theatreRes.Item.screens || []).find(s => s.screenId === screenId);
  if (!screen) fail('Screen not found on that theatre', 404);

  return { movie: movieRes.Item, theatre: theatreRes.Item, screen };
}

/** The screen and the film must agree on a format before a show can exist. */
function resolveFormat(requested, movie, screen) {
  const shared = screen.supportedFormats.filter(f => (movie.formats || []).includes(f));
  if (!shared.length) {
    throw Object.assign(
      new Error(`${movie.title} (${(movie.formats || []).join(', ')}) can't play on ${screen.name} (${screen.supportedFormats.join(', ')})`),
      { status: 400 }
    );
  }
  if (!requested) return shared[0];
  if (!FORMAT_IDS.includes(requested)) {
    throw Object.assign(new Error(`Unknown format "${requested}"`), { status: 400 });
  }
  if (!shared.includes(requested)) {
    throw Object.assign(
      new Error(`${requested} isn't available for this film on this screen. Options: ${shared.join(', ')}`),
      { status: 400 }
    );
  }
  return requested;
}

// POST /api/shows (admin) — a single show
router.post('/', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { movieId, theatreId, screenId, format, date, time24 } = req.body;
    if (!movieId || !theatreId || !screenId || !date || !time24) {
      return res.status(400).json({ error: 'movieId, theatreId, screenId, date and time24 are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (!/^\d{2}:\d{2}$/.test(time24)) return res.status(400).json({ error: 'time24 must be HH:mm' });

    const { movie, theatre, screen } = await loadMovieAndScreen(movieId, theatreId, screenId);
    const resolved = resolveFormat(format, movie, screen);

    const show = buildShow({ movie, theatre, screen, format: resolved, date, time24 });
    await docClient.send(new PutCommand({ TableName: TABLES.SHOWS, Item: show }));

    res.status(201).json({ message: 'Show created', showId: show.showId, show });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/shows/generate (admin)
 * Fills a screen's schedule for the next N days in one go — the realistic way
 * to populate a week rather than clicking in 35 shows by hand.
 */
router.post('/generate', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { movieId, theatreId, screenId, format, times, days } = req.body;
    if (!movieId || !theatreId || !screenId || !Array.isArray(times) || !times.length) {
      return res.status(400).json({ error: 'movieId, theatreId, screenId and a times[] array are required' });
    }

    const badTimes = times.filter(t => !/^\d{2}:\d{2}$/.test(t));
    if (badTimes.length) return res.status(400).json({ error: `Invalid time(s): ${badTimes.join(', ')}` });

    const dayCount = Math.min(Number(days) || BOOKING_WINDOW_DAYS, 30);
    const { movie, theatre, screen } = await loadMovieAndScreen(movieId, theatreId, screenId);
    const resolved = resolveFormat(format, movie, screen);

    const shows = [];
    for (let d = 0; d < dayCount; d++) {
      const dt = new Date();
      dt.setHours(0, 0, 0, 0);
      dt.setDate(dt.getDate() + d);
      const date = dt.toISOString().slice(0, 10);
      for (const time24 of times) {
        shows.push(buildShow({ movie, theatre, screen, format: resolved, date, time24 }));
      }
    }

    for (let i = 0; i < shows.length; i += 25) {
      await docClient.send(new BatchWriteCommand({
        RequestItems: {
          [TABLES.SHOWS]: shows.slice(i, i + 25).map(Item => ({ PutRequest: { Item } })),
        },
      }));
    }

    res.status(201).json({
      message: `Created ${shows.length} shows for ${movie.title} at ${theatre.name}`,
      count: shows.length,
      format: resolved,
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/shows/:showId (admin) — refuses if anyone has booked into it. */
router.delete('/:showId', authenticate, adminOnly, async (req, res, next) => {
  try {
    const locks = await docClient.send(new QueryCommand({
      TableName: TABLES.SEAT_LOCKS,
      KeyConditionExpression: 'showId = :s',
      ExpressionAttributeValues: { ':s': req.params.showId },
      Select: 'COUNT',
    }));

    if (locks.Count > 0) {
      return res.status(409).json({
        error: `${locks.Count} seat(s) are booked on this show. Cancel those bookings first.`,
      });
    }

    await docClient.send(new DeleteCommand({
      TableName: TABLES.SHOWS,
      Key: { showId: req.params.showId },
    }));
    res.json({ message: 'Show deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
