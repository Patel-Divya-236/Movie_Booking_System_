const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../db');
const { PutCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
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
    const { title, genre, duration, price, showtimes, posterUrl, description } = req.body;
    if (!title || !genre || !price || !showtimes) {
      return res.status(400).json({ error: 'Title, genre, price, and showtimes are required' });
    }

    const movieId = uuidv4();
    await docClient.send(new PutCommand({
      TableName: 'MovieBooking_Movies',
      Item: {
        movieId,
        title,
        genre,
        duration: duration || '2h 0m',
        price: Number(price),
        showtimes: Array.isArray(showtimes) ? showtimes : [showtimes],
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
