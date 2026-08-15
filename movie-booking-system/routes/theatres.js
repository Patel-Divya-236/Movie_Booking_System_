const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { docClient, TABLES } = require('../db');
const { PutCommand, ScanCommand, GetCommand, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { authenticate, adminOnly } = require('../middleware/auth');
const { LAYOUTS } = require('../config/seatLayouts');
const { FORMAT_IDS } = require('../config/pricing');
const { CITIES } = require('../config/catalog');

const router = express.Router();

// GET /api/theatres?city=mumbai
router.get('/', async (req, res, next) => {
  try {
    const { city } = req.query;

    const result = city
      ? await docClient.send(new QueryCommand({
          TableName: TABLES.THEATRES,
          IndexName: 'city-index',
          KeyConditionExpression: 'city = :c',
          ExpressionAttributeValues: { ':c': city },
        }))
      : await docClient.send(new ScanCommand({ TableName: TABLES.THEATRES }));

    const theatres = (result.Items || []).sort((a, b) => a.name.localeCompare(b.name));
    res.json(theatres);
  } catch (err) {
    next(err);
  }
});

// GET /api/theatres/:id
router.get('/:id', async (req, res, next) => {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: TABLES.THEATRES,
      Key: { theatreId: req.params.id },
    }));
    if (!result.Item) return res.status(404).json({ error: 'Theatre not found' });
    res.json(result.Item);
  } catch (err) {
    next(err);
  }
});

function parseTheatreBody(body) {
  const fail = msg => { throw Object.assign(new Error(msg), { status: 400 }); };

  const name = String(body.name || '').trim();
  const city = String(body.city || '').trim();
  const area = String(body.area || '').trim();

  if (!name) fail('Theatre name is required');
  if (!CITIES.some(c => c.id === city)) {
    fail(`City must be one of: ${CITIES.map(c => c.id).join(', ')}`);
  }

  const screens = Array.isArray(body.screens) ? body.screens : [];
  if (!screens.length) fail('Add at least one screen');

  const parsedScreens = screens.map((s, i) => {
    if (!LAYOUTS[s.layoutId]) fail(`Unknown layout "${s.layoutId}" on screen ${i + 1}`);

    const formats = Array.isArray(s.supportedFormats) ? s.supportedFormats : [];
    const badFormats = formats.filter(f => !FORMAT_IDS.includes(f));
    if (badFormats.length) fail(`Unknown format(s) on screen ${i + 1}: ${badFormats.join(', ')}`);
    if (!formats.length) fail(`Screen ${i + 1} needs at least one format`);

    // A price is required for every tier the layout actually contains, and no
    // stray tiers the screen doesn't sell.
    const tiers = [...new Set(LAYOUTS[s.layoutId].sections.map(sec => sec.tier))];
    const basePrices = {};
    for (const tier of tiers) {
      const price = Number(s.basePrices && s.basePrices[tier]);
      if (!Number.isFinite(price) || price <= 0) {
        fail(`Screen ${i + 1} needs a valid ${tier} price`);
      }
      basePrices[tier] = Math.round(price);
    }

    return {
      screenId: s.screenId || `S${i + 1}`,
      name: String(s.name || `Screen ${i + 1}`).trim(),
      layoutId: s.layoutId,
      supportedFormats: formats,
      basePrices,
    };
  });

  return { name, city, area, screens: parsedScreens };
}

// POST /api/theatres (admin)
router.post('/', authenticate, adminOnly, async (req, res, next) => {
  try {
    const theatre = parseTheatreBody(req.body);
    const theatreId = uuidv4();
    await docClient.send(new PutCommand({
      TableName: TABLES.THEATRES,
      Item: { theatreId, ...theatre, createdAt: new Date().toISOString() },
    }));
    res.status(201).json({ message: 'Theatre added', theatreId });
  } catch (err) {
    next(err);
  }
});

// PUT /api/theatres/:id (admin)
router.put('/:id', authenticate, adminOnly, async (req, res, next) => {
  try {
    const existing = await docClient.send(new GetCommand({
      TableName: TABLES.THEATRES,
      Key: { theatreId: req.params.id },
    }));
    if (!existing.Item) return res.status(404).json({ error: 'Theatre not found' });

    const theatre = parseTheatreBody(req.body);
    await docClient.send(new PutCommand({
      TableName: TABLES.THEATRES,
      Item: {
        ...existing.Item,
        ...theatre,
        theatreId: req.params.id,
        updatedAt: new Date().toISOString(),
      },
    }));
    res.json({ message: 'Theatre updated' });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/theatres/:id (admin) — blocked while upcoming shows exist. */
router.delete('/:id', authenticate, adminOnly, async (req, res, next) => {
  try {
    const theatre = await docClient.send(new GetCommand({
      TableName: TABLES.THEATRES,
      Key: { theatreId: req.params.id },
    }));
    if (!theatre.Item) return res.status(404).json({ error: 'Theatre not found' });

    const today = new Date().toISOString().slice(0, 10);
    const shows = await docClient.send(new QueryCommand({
      TableName: TABLES.SHOWS,
      IndexName: 'city-date-index',
      KeyConditionExpression: 'city = :c AND dateStart >= :d',
      FilterExpression: 'theatreId = :t',
      ExpressionAttributeValues: {
        ':c': theatre.Item.city,
        ':d': `${today}#00:00`,
        ':t': req.params.id,
      },
      Limit: 1,
    }));

    if (shows.Items && shows.Items.length > 0) {
      return res.status(409).json({
        error: 'This theatre still has upcoming shows. Delete those first.',
      });
    }

    await docClient.send(new DeleteCommand({
      TableName: TABLES.THEATRES,
      Key: { theatreId: req.params.id },
    }));
    res.json({ message: 'Theatre deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
