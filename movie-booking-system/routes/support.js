/**
 * Support tickets.
 *
 * A signed-in user raises a ticket, optionally attached to a booking. Staff
 * reply on the same thread, so the whole conversation lives in one item
 * rather than being scattered across email.
 */

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { docClient, TABLES } = require('../db');
const { PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { authenticate, adminOnly } = require('../middleware/auth');
const { SUPPORT_CATEGORIES, SUPPORT_STATUSES, SUPPORT_PRIORITIES } = require('../config/catalog');
const notify = require('../services/notify');

const router = express.Router();

const CATEGORY_IDS = SUPPORT_CATEGORIES.map(c => c.id);
const MAX_MESSAGE = 4000;

/** Short reference a user can quote: SUP-4KQ7X2 */
function makeTicketRef() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let ref = '';
  for (const b of crypto.randomBytes(6)) ref += alphabet[b % alphabet.length];
  return `SUP-${ref}`;
}

function canAccess(ticket, user) {
  return user.role === 'admin' || ticket.userId === user.userId;
}

// ------------------------------------------------------------------- create

/**
 * POST /api/support
 * Body: { category, subject, message, bookingRef? }
 */
router.post('/', authenticate, async (req, res, next) => {
  try {
    const category = String(req.body.category || '').trim();
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    const bookingRef = String(req.body.bookingRef || '').trim();

    if (!CATEGORY_IDS.includes(category)) {
      return res.status(400).json({ error: `Category must be one of: ${CATEGORY_IDS.join(', ')}` });
    }
    if (subject.length < 4) return res.status(400).json({ error: 'Give your issue a short subject' });
    if (message.length < 15) {
      return res.status(400).json({ error: 'Please describe the problem in a bit more detail' });
    }
    if (message.length > MAX_MESSAGE) {
      return res.status(400).json({ error: `Keep the description under ${MAX_MESSAGE} characters` });
    }

    // Stop users spamming identical open tickets.
    const mine = await docClient.send(new QueryCommand({
      TableName: TABLES.SUPPORT,
      IndexName: 'userId-createdAt-index',
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': req.user.userId },
      ScanIndexForward: false,
      Limit: 5,
    }));
    const duplicate = (mine.Items || []).find(
      t => t.subject === subject && ['open', 'in_progress'].includes(t.status)
    );
    if (duplicate) {
      return res.status(409).json({
        error: `You already have an open ticket for this (${duplicate.ticketRef})`,
        ticketId: duplicate.ticketId,
      });
    }

    const now = new Date().toISOString();
    const ticket = {
      ticketId: uuidv4(),
      ticketRef: makeTicketRef(),

      userId: req.user.userId,
      userName: req.user.name,
      userEmail: req.user.email,

      category,
      subject,
      bookingRef: bookingRef || null,

      status: 'open',
      priority: category === 'payment' || category === 'booking' ? 'high' : 'normal',

      messages: [{ from: 'user', author: req.user.name, body: message, at: now }],

      createdAt: now,
      updatedAt: now,
      // GSI partition key: one value so tickets sort by date across all users.
      allTickets: 'ALL',
    };

    await docClient.send(new PutCommand({ TableName: TABLES.SUPPORT, Item: ticket }));

    res.status(201).json({
      message: 'Ticket raised — we will get back to you by email',
      ticketId: ticket.ticketId,
      ticketRef: ticket.ticketRef,
      ticket,
    });

    notify.sendSupportTicketRaised(ticket).catch(err => {
      console.warn('Support notification failed (ticket still saved):', err.message);
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------------- reads

/** GET /api/support — my tickets, or every ticket for an admin. */
router.get('/', authenticate, async (req, res, next) => {
  try {
    let items;
    if (req.user.role === 'admin') {
      const { status } = req.query;
      const result = await docClient.send(new QueryCommand({
        TableName: TABLES.SUPPORT,
        IndexName: 'allTickets-createdAt-index',
        KeyConditionExpression: 'allTickets = :a',
        ExpressionAttributeValues: { ':a': 'ALL' },
        ScanIndexForward: false,
      }));
      items = result.Items || [];
      if (status && SUPPORT_STATUSES.includes(status)) {
        items = items.filter(t => t.status === status);
      }
    } else {
      const result = await docClient.send(new QueryCommand({
        TableName: TABLES.SUPPORT,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :u',
        ExpressionAttributeValues: { ':u': req.user.userId },
        ScanIndexForward: false,
      }));
      items = result.Items || [];
    }
    res.json(items);
  } catch (err) {
    next(err);
  }
});

/** GET /api/support/:id */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const found = await docClient.send(new GetCommand({
      TableName: TABLES.SUPPORT,
      Key: { ticketId: req.params.id },
    }));
    const ticket = found.Item;
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (!canAccess(ticket, req.user)) return res.status(403).json({ error: 'Not your ticket' });
    res.json(ticket);
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ replies

/** POST /api/support/:id/reply — both sides use this. */
router.post('/:id/reply', authenticate, async (req, res, next) => {
  try {
    const body = String(req.body.message || '').trim();
    if (body.length < 2) return res.status(400).json({ error: 'Write a reply first' });
    if (body.length > MAX_MESSAGE) {
      return res.status(400).json({ error: `Keep it under ${MAX_MESSAGE} characters` });
    }

    const found = await docClient.send(new GetCommand({
      TableName: TABLES.SUPPORT,
      Key: { ticketId: req.params.id },
    }));
    const ticket = found.Item;
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (!canAccess(ticket, req.user)) return res.status(403).json({ error: 'Not your ticket' });
    if (ticket.status === 'closed') {
      return res.status(409).json({ error: 'This ticket is closed. Raise a new one if you still need help.' });
    }

    const isStaff = req.user.role === 'admin';
    const now = new Date().toISOString();
    const reply = { from: isStaff ? 'support' : 'user', author: req.user.name, body, at: now };

    // A staff reply moves an open ticket to in_progress; a user reply reopens
    // one that was marked resolved.
    let status = ticket.status;
    if (isStaff && status === 'open') status = 'in_progress';
    if (!isStaff && status === 'resolved') status = 'in_progress';

    await docClient.send(new UpdateCommand({
      TableName: TABLES.SUPPORT,
      Key: { ticketId: ticket.ticketId },
      UpdateExpression:
        'SET messages = list_append(messages, :m), updatedAt = :now, #s = :status',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':m': [reply], ':now': now, ':status': status },
    }));

    res.json({ message: 'Reply added', reply, status });

    // Only email the customer when staff reply — they are not watching the page.
    if (isStaff) {
      notify.sendSupportReply({ ...ticket, status }, reply).catch(err => {
        console.warn('Support reply email failed:', err.message);
      });
    }
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/support/:id — admin changes status or priority. */
router.patch('/:id', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { status, priority } = req.body;
    const sets = ['updatedAt = :now'];
    const names = {};
    const values = { ':now': new Date().toISOString() };

    if (status !== undefined) {
      if (!SUPPORT_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Status must be one of: ${SUPPORT_STATUSES.join(', ')}` });
      }
      sets.push('#s = :status');
      names['#s'] = 'status';
      values[':status'] = status;
    }
    if (priority !== undefined) {
      if (!SUPPORT_PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: `Priority must be one of: ${SUPPORT_PRIORITIES.join(', ')}` });
      }
      sets.push('priority = :priority');
      values[':priority'] = priority;
    }
    if (sets.length === 1) return res.status(400).json({ error: 'Nothing to update' });

    await docClient.send(new UpdateCommand({
      TableName: TABLES.SUPPORT,
      Key: { ticketId: req.params.id },
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
      ConditionExpression: 'attribute_exists(ticketId)',
    }));

    res.json({ message: 'Ticket updated' });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    next(err);
  }
});

module.exports = router;
