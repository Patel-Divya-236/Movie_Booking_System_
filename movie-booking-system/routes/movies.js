const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { docClient, TABLES, queryAll } = require('../db');
const { PutCommand, ScanCommand, GetCommand, DeleteCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { authenticate, adminOnly } = require('../middleware/auth');
const { GENRES, LANGUAGES, CERTIFICATES, MOVIE_STATUS } = require('../config/catalog');
const { FORMAT_IDS } = require('../config/pricing');

const router = express.Router();

/**
 * GET /api/movies?city=mumbai&status=now_showing
 *
 * The full catalog is small and read on every page, so a Scan is honest here.
 * When a city is given we narrow to films that actually have a show there —
 * that part is a Query against the shows index, not a Scan.
 */
router.get('/', async (req, res, next) => {
  try {
    const { city, status } = req.query;

    const result = await docClient.send(new ScanCommand({ TableName: TABLES.MOVIES }));
    let movies = result.Items || [];

    if (status) movies = movies.filter(m => m.status === status);

    if (city) {
      const today = new Date().toISOString().slice(0, 10);
      // Paged: a fortnight of a city's showtimes exceeds DynamoDB's 1MB cap,
      // and a truncated read would drop films off the listing page.
      const shows = await queryAll(QueryCommand, {
        TableName: TABLES.SHOWS,
        IndexName: 'city-date-index',
        KeyConditionExpression: 'city = :c AND dateStart >= :d',
        ExpressionAttributeValues: { ':c': city, ':d': `${today}#00:00` },
        ProjectionExpression: 'movieId, #l, #f',
        ExpressionAttributeNames: { '#l': 'language', '#f': 'format' },
      });

      // What each film is actually showing in *here* — a dubbed release plays
      // in languages the movie record itself does not list, and a city only
      // gets the formats its screens support.
      const playing = new Map();
      for (const s of shows) {
        if (!playing.has(s.movieId)) playing.set(s.movieId, { languages: new Set(), formats: new Set() });
        playing.get(s.movieId).languages.add(s.language);
        playing.get(s.movieId).formats.add(s.format);
      }

      movies = movies
        // Coming-soon titles have no shows yet but still belong on the page.
        .filter(m => playing.has(m.movieId) || m.status === 'coming_soon')
        .map(m => {
          const local = playing.get(m.movieId);
          return local
            ? {
                ...m,
                languagesInCity: [...local.languages].sort(),
                formatsInCity: [...local.formats].sort(),
              }
            : m;
        });
    }

    movies.sort((a, b) => a.title.localeCompare(b.title));
    res.json(movies);
  } catch (err) {
    next(err);
  }
});

// GET /api/movies/:id
router.get('/:id', async (req, res, next) => {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: TABLES.MOVIES,
      Key: { movieId: req.params.id },
    }));
    if (!result.Item) return res.status(404).json({ error: 'Movie not found' });
    res.json(result.Item);
  } catch (err) {
    next(err);
  }
});

/** Shared validation/normalisation for create and update. */
function parseMovieBody(body, { partial = false } = {}) {
  const out = {};
  const fail = msg => { throw Object.assign(new Error(msg), { status: 400 }); };

  if (body.title !== undefined) out.title = String(body.title).trim();
  else if (!partial) fail('Title is required');

  if (body.genre !== undefined) {
    if (!GENRES.includes(body.genre)) fail(`Genre must be one of: ${GENRES.join(', ')}`);
    out.genre = body.genre;
  } else if (!partial) fail('Genre is required');

  if (body.language !== undefined) {
    if (!LANGUAGES.includes(body.language)) fail(`Language must be one of: ${LANGUAGES.join(', ')}`);
    out.language = body.language;
  } else if (!partial) out.language = 'Hindi';

  if (body.formats !== undefined) {
    const formats = Array.isArray(body.formats)
      ? body.formats
      : String(body.formats).split(',').map(s => s.trim()).filter(Boolean);
    const bad = formats.filter(f => !FORMAT_IDS.includes(f));
    if (bad.length) fail(`Unknown format(s): ${bad.join(', ')}`);
    if (!formats.length) fail('Pick at least one format');
    out.formats = formats;
  } else if (!partial) out.formats = ['2D'];

  if (body.certificate !== undefined) {
    if (!CERTIFICATES.includes(body.certificate)) fail(`Certificate must be one of: ${CERTIFICATES.join(', ')}`);
    out.certificate = body.certificate;
  } else if (!partial) out.certificate = 'UA';

  if (body.status !== undefined) {
    if (!MOVIE_STATUS.includes(body.status)) fail('Status must be now_showing or coming_soon');
    out.status = body.status;
  } else if (!partial) out.status = 'now_showing';

  if (body.duration !== undefined) out.duration = String(body.duration).trim();
  else if (!partial) out.duration = '2h 0m';

  for (const field of ['posterUrl', 'backdropUrl', 'trailerUrl', 'description', 'releaseDate']) {
    if (body[field] !== undefined) out[field] = String(body[field]).trim();
    else if (!partial) out[field] = '';
  }

  if (body.rating !== undefined) {
    out.rating = body.rating === '' || body.rating === null ? null : Number(body.rating);
  }

  return out;
}

// POST /api/movies (admin)
router.post('/', authenticate, adminOnly, async (req, res, next) => {
  try {
    const movie = parseMovieBody(req.body);
    const movieId = uuidv4();
    await docClient.send(new PutCommand({
      TableName: TABLES.MOVIES,
      Item: { movieId, ...movie, createdAt: new Date().toISOString() },
    }));
    res.status(201).json({ message: 'Movie added', movieId });
  } catch (err) {
    next(err);
  }
});

// PUT /api/movies/:id (admin)
router.put('/:id', authenticate, adminOnly, async (req, res, next) => {
  try {
    const updates = parseMovieBody(req.body, { partial: true });
    updates.updatedAt = new Date().toISOString();

    const names = {};
    const values = {};
    const sets = Object.keys(updates).map((key, i) => {
      names[`#k${i}`] = key;
      values[`:v${i}`] = updates[key];
      return `#k${i} = :v${i}`;
    });

    await docClient.send(new UpdateCommand({
      TableName: TABLES.MOVIES,
      Key: { movieId: req.params.id },
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(movieId)',
    }));

    res.json({ message: 'Movie updated' });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return res.status(404).json({ error: 'Movie not found' });
    }
    next(err);
  }
});

/**
 * DELETE /api/movies/:id (admin)
 * Refuses while shows still reference the film, so the schedule can't be left
 * pointing at a movie that no longer exists.
 */
router.delete('/:id', authenticate, adminOnly, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const shows = await docClient.send(new QueryCommand({
      TableName: TABLES.SHOWS,
      IndexName: 'movieId-date-index',
      KeyConditionExpression: 'movieId = :m AND dateStart >= :d',
      ExpressionAttributeValues: { ':m': req.params.id, ':d': `${today}#00:00` },
      Limit: 1,
    }));

    if (shows.Items && shows.Items.length > 0) {
      return res.status(409).json({
        error: 'This movie still has upcoming shows. Delete those first.',
      });
    }

    await docClient.send(new DeleteCommand({
      TableName: TABLES.MOVIES,
      Key: { movieId: req.params.id },
    }));
    res.json({ message: 'Movie deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
