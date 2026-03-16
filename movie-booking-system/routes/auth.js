const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../db');
const { PutCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check if user already exists
    const existing = await docClient.send(new ScanCommand({
      TableName: 'MovieBooking_Users',
      FilterExpression: 'email = :e',
      ExpressionAttributeValues: { ':e': email },
    }));

    if (existing.Items && existing.Items.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    await docClient.send(new PutCommand({
      TableName: 'MovieBooking_Users',
      Item: {
        userId,
        name,
        email,
        password: hashedPassword,
        role: role === 'admin' ? 'admin' : 'user',
        createdAt: new Date().toISOString(),
      },
    }));

    res.status(201).json({ message: 'Registration successful! Please login.' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await docClient.send(new ScanCommand({
      TableName: 'MovieBooking_Users',
      FilterExpression: 'email = :e',
      ExpressionAttributeValues: { ':e': email },
    }));

    if (!result.Items || result.Items.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.Items[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.userId, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: { userId: user.userId, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
