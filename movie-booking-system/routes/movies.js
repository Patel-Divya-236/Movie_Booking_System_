const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../db');
const { PutCommand, ScanCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/movies — list all movies (public)
router.get('/', async (req, res) => {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: 'MovieBooking_Movies',
    }));
    res.json(result.Items || []);
  } catch (err) {
    console.error('List movies error:', err);
    res.status(500).json({ error: 'Failed to fetch movies' });
  }
});

// POST /api/movies — add a movie (admin only)
router.post('/', authenticate, adminOnly, async (req, res) => {
  try {
    const { title, genre, language, duration, price, showtimes, screen, posterUrl, description } = req.body;
    if (!title || !genre || !showtimes) {
      return res.status(400).json({ error: 'Title, genre, and showtimes are required' });
    }

    // Handle price — can be a number or {normal, sofa, recliner}
    let parsedPrice = price;
    if (typeof price === 'string' || typeof price === 'number') {
      const p = Number(price);
      parsedPrice = { normal: p, sofa: Math.round(p * 1.6), recliner: Math.round(p * 2.5) };
    }

    const movieId = uuidv4();
    await docClient.send(new PutCommand({
      TableName: 'MovieBooking_Movies',
      Item: {
        movieId,
        title,
        genre,
        language: language || 'Hindi',
        duration: duration || '2h 0m',
        price: parsedPrice,
        showtimes: Array.isArray(showtimes) ? showtimes : showtimes.split(',').map(s => s.trim()),
        screen: screen || 'Screen 1 — Standard',
        posterUrl: posterUrl || '',
        description: description || '',
        createdAt: new Date().toISOString(),
      },
    }));

    res.status(201).json({ message: 'Movie added successfully', movieId });
  } catch (err) {
    console.error('Add movie error:', err);
    res.status(500).json({ error: 'Failed to add movie' });
  }
});

// PUT /api/movies/:id — edit a movie (admin only)
router.put('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const { title, genre, language, duration, price, showtimes, screen, posterUrl, description } = req.body;

    // Handle price
    let parsedPrice = price;
    if (typeof price === 'string' || typeof price === 'number') {
      const p = Number(price);
      parsedPrice = { normal: p, sofa: Math.round(p * 1.6), recliner: Math.round(p * 2.5) };
    }

    // Build update expression dynamically
    const updates = {};
    if (title) updates.title = title;
    if (genre) updates.genre = genre;
    if (language) updates.language = language;
    if (duration) updates.duration = duration;
    if (parsedPrice) updates.price = parsedPrice;
    if (showtimes) updates.showtimes = Array.isArray(showtimes) ? showtimes : showtimes.split(',').map(s => s.trim());
    if (screen) updates.screen = screen;
    if (posterUrl !== undefined) updates.posterUrl = posterUrl;
    if (description !== undefined) updates.description = description;
    updates.updatedAt = new Date().toISOString();

    const expressions = [];
    const names = {};
    const values = {};

    Object.keys(updates).forEach((key, i) => {
      const nameKey = `#k${i}`;
      const valKey = `:v${i}`;
      expressions.push(`${nameKey} = ${valKey}`);
      names[nameKey] = key;
      values[valKey] = updates[key];
    });

    await docClient.send(new UpdateCommand({
      TableName: 'MovieBooking_Movies',
      Key: { movieId: req.params.id },
      UpdateExpression: 'SET ' + expressions.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));

    res.json({ message: 'Movie updated successfully' });
  } catch (err) {
    console.error('Update movie error:', err);
    res.status(500).json({ error: 'Failed to update movie' });
  }
});

// DELETE /api/movies/:id — delete a movie (admin only)
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await docClient.send(new DeleteCommand({
      TableName: 'MovieBooking_Movies',
      Key: { movieId: req.params.id },
    }));
    res.json({ message: 'Movie deleted' });
  } catch (err) {
    console.error('Delete movie error:', err);
    res.status(500).json({ error: 'Failed to delete movie' });
  }
});

module.exports = router;
