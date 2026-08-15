const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { docClient, TABLES } = require('../db');
const { PutCommand, QueryCommand, UpdateCommand, GetCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { authenticate } = require('../middleware/auth');
const { VERIFICATION_TOKEN_HOURS, PENDING_SIGNUP_TTL_HOURS } = require('../config/catalog');
const { validateEmail, validatePassword, validateName } = require('../config/validation');
const { canReceiveMail } = require('../services/emailCheck');
const notify = require('../services/notify');

const router = express.Router();

/** Look a user up by email through the GSI — this used to Scan the whole table. */
async function findByEmail(email) {
  const res = await docClient.send(new QueryCommand({
    TableName: TABLES.USERS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :e',
    ExpressionAttributeValues: { ':e': email },
  }));
  return res.Items && res.Items[0];
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Verification tokens.
 *
 * The raw token goes in the emailed link; only its SHA-256 hash is stored, so
 * a leaked database dump cannot be used to verify anyone's address. Same
 * reasoning as hashing passwords, on a smaller scale.
 */
function createVerificationToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return {
    raw,
    hash: crypto.createHash('sha256').update(raw).digest('hex'),
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_HOURS * 3600_000).toISOString(),
  };
}

const hashToken = raw => crypto.createHash('sha256').update(String(raw)).digest('hex');

function signToken(user) {
  return jwt.sign(
    {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: Boolean(user.emailVerified),
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function publicUser(user) {
  return {
    userId: user.userId,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: Boolean(user.emailVerified),
  };
}

// ------------------------------------------------------------------ register

router.post('/register', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    // `field` tells the form which input to mark, so the error lands next to
    // the offending box rather than as a generic banner.
    const nameCheck = validateName(req.body.name);
    if (!nameCheck.valid) return res.status(400).json({ error: nameCheck.error, field: 'name' });
    const name = nameCheck.name;

    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) {
      return res.status(400).json({ error: emailCheck.error, field: 'email', suggestion: emailCheck.suggestion });
    }

    const passwordCheck = validatePassword(password, { email, name });
    if (!passwordCheck.valid) {
      return res.status(400).json({ error: passwordCheck.error, field: 'password' });
    }

    // Does a mail server actually exist for this domain? Stops invented
    // domains that pass every format check.
    const domain = await canReceiveMail(emailCheck.domain);
    if (!domain.deliverable) {
      return res.status(400).json({
        error: `We can't deliver email to "${emailCheck.domain}" — ${domain.reason}. Check the spelling.`,
        field: 'email',
      });
    }

    if (await findByEmail(email)) {
      return res.status(409).json({ error: 'Email already registered', field: 'email' });
    }

    // The account is NOT created here. It waits in PendingSignups until the
    // emailed link is clicked, so a mistyped address leaves nothing behind and
    // the user can simply sign up again with the correct one. Re-registering
    // the same address overwrites the pending record, which doubles as
    // "resend me the link".
    const token = createVerificationToken();
    const pending = {
      email,
      name,
      passwordHash: await bcrypt.hash(password, 10),
      verificationTokenHash: token.hash,
      expiresAt: token.expiresAt,
      // DynamoDB TTL is in epoch seconds; unconfirmed signups are swept away.
      ttl: Math.floor(Date.now() / 1000) + PENDING_SIGNUP_TTL_HOURS * 3600,
      createdAt: new Date().toISOString(),
    };

    await docClient.send(new PutCommand({ TableName: TABLES.PENDING, Item: pending }));

    const sent = await notify.sendVerificationEmail({ name, email }, token.raw);

    res.status(201).json({
      pending: true,
      emailSent: sent,
      email,
      message: sent
        ? `Almost there — we've emailed a confirmation link to ${email}. Your account is created once you click it.`
        : `We couldn't send the email to ${email}. Check the address, or contact support.`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/check-email
 * Live validation for the signup form: format, domain typos, MX records and
 * whether the address is already taken — before the user commits to the form.
 * Deliberately not authenticated, but it only ever answers about an address
 * the caller already typed.
 */
router.post('/check-email', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);

    const check = validateEmail(email);
    if (!check.valid) {
      return res.json({ ok: false, error: check.error, suggestion: check.suggestion });
    }

    const domain = await canReceiveMail(check.domain);
    if (!domain.deliverable) {
      return res.json({
        ok: false,
        error: `We can't deliver email to "${check.domain}" — ${domain.reason}. Check the spelling.`,
      });
    }

    if (await findByEmail(email)) {
      return res.json({ ok: false, error: 'That email is already registered', registered: true });
    }

    res.json({ ok: true, domain: check.domain, verifiedDomain: domain.checked });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------- login

router.post('/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await findByEmail(email);
    // Same message either way, so this can't be used to enumerate accounts.
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------- verification

/**
 * GET /api/auth/verify?token=…
 *
 * This is where the account is actually created. Up to this point the signup
 * only existed as a pending record; clicking the link is what proves the
 * address belongs to the person who typed it.
 *
 * Also handles the older flow, where accounts were created unverified — those
 * users still have a token on their user record.
 */
router.get('/verify', async (req, res, next) => {
  try {
    const raw = req.query.token;
    if (!raw) return res.status(400).json({ error: 'Verification token missing' });

    const hash = hashToken(raw);

    // --- New flow: promote a pending signup into a real account.
    const pendingMatch = await docClient.send(new ScanCommand({
      TableName: TABLES.PENDING,
      FilterExpression: 'verificationTokenHash = :h',
      ExpressionAttributeValues: { ':h': hash },
    }));
    const pending = pendingMatch.Items?.[0];

    if (pending) {
      if (new Date(pending.expiresAt).getTime() < Date.now()) {
        await docClient.send(new DeleteCommand({ TableName: TABLES.PENDING, Key: { email: pending.email } }));
        return res.status(410).json({
          error: 'This link has expired. Please sign up again.',
          expired: true,
        });
      }

      // Someone may have registered that address in the meantime.
      const existing = await findByEmail(pending.email);
      if (existing) {
        await docClient.send(new DeleteCommand({ TableName: TABLES.PENDING, Key: { email: pending.email } }));
        return res.json({ message: 'That account already exists — please sign in.', alreadyVerified: true });
      }

      const user = {
        userId: uuidv4(),
        name: pending.name,
        email: pending.email,
        password: pending.passwordHash,
        // Role is never taken from the request body — self-promotion to admin
        // would otherwise be a single curl away.
        role: 'user',
        emailVerified: true,
        verifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      await docClient.send(new PutCommand({
        TableName: TABLES.USERS,
        Item: user,
        ConditionExpression: 'attribute_not_exists(userId)',
      }));
      await docClient.send(new DeleteCommand({ TableName: TABLES.PENDING, Key: { email: pending.email } }));

      // Signed in immediately — they have just proved they own the address.
      return res.json({
        message: `Welcome aboard, ${user.name}! Your account is ready.`,
        created: true,
        token: signToken(user),
        user: publicUser(user),
      });
    }

    // --- Legacy flow: an account that already exists but is unverified.
    const found = await docClient.send(new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: 'verificationTokenHash = :h',
      ExpressionAttributeValues: { ':h': hash },
    }));
    const user = found.Items?.[0];

    if (!user) {
      return res.status(400).json({ error: 'This link is invalid or has already been used' });
    }
    if (user.emailVerified) {
      return res.json({ message: 'Your email is already verified', alreadyVerified: true });
    }
    if (new Date(user.verificationExpiresAt).getTime() < Date.now()) {
      return res.status(410).json({
        error: 'This link has expired. Sign in and request a new one.',
        expired: true,
      });
    }

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { userId: user.userId },
      UpdateExpression:
        'SET emailVerified = :true, verifiedAt = :now REMOVE verificationTokenHash, verificationExpiresAt',
      ExpressionAttributeValues: { ':true': true, ':now': new Date().toISOString() },
    }));

    const updated = { ...user, emailVerified: true };
    res.json({
      message: 'Email verified — thanks!',
      token: signToken(updated),
      user: publicUser(updated),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/resend-signup
 * Re-sends the link for a signup still waiting to be confirmed, or reports
 * that the address was never used. Deliberately vague about which, so this
 * cannot be used to discover who has an account.
 */
router.post('/resend-signup', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const generic = { message: `If ${email} has a signup waiting, we've sent the link again.` };

    const found = await docClient.send(new GetCommand({ TableName: TABLES.PENDING, Key: { email } }));
    if (!found.Item) return res.json(generic);

    const token = createVerificationToken();
    await docClient.send(new UpdateCommand({
      TableName: TABLES.PENDING,
      Key: { email },
      UpdateExpression: 'SET verificationTokenHash = :h, expiresAt = :e, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':h': token.hash,
        ':e': token.expiresAt,
        ':ttl': Math.floor(Date.now() / 1000) + PENDING_SIGNUP_TTL_HOURS * 3600,
      },
    }));

    await notify.sendVerificationEmail({ name: found.Item.name, email }, token.raw);
    res.json(generic);
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/resend-verification — new link for the signed-in user. */
router.post('/resend-verification', authenticate, async (req, res, next) => {
  try {
    const found = await docClient.send(new GetCommand({
      TableName: TABLES.USERS,
      Key: { userId: req.user.userId },
    }));
    const user = found.Item;
    if (!user) return res.status(404).json({ error: 'Account not found' });
    if (user.emailVerified) {
      return res.status(409).json({ error: 'Your email is already verified' });
    }

    const token = createVerificationToken();
    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { userId: user.userId },
      UpdateExpression: 'SET verificationTokenHash = :h, verificationExpiresAt = :e',
      ExpressionAttributeValues: { ':h': token.hash, ':e': token.expiresAt },
    }));

    // The mailer never throws — it reports whether any provider delivered.
    const sent = await notify.sendVerificationEmail(user, token.raw);

    res.json({
      sent,
      message: sent
        ? `Verification link sent to ${user.email}`
        : 'We could not send the email just now. Raise a support request and we will verify your address manually.',
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/change-password */
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const found = await docClient.send(new GetCommand({
      TableName: TABLES.USERS,
      Key: { userId: req.user.userId },
    }));
    const user = found.Item;
    if (!user) return res.status(404).json({ error: 'Account not found' });

    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ error: 'That is not your current password', field: 'currentPassword' });
    }

    const check = validatePassword(newPassword, { email: user.email, name: user.name });
    if (!check.valid) return res.status(400).json({ error: check.error, field: 'newPassword' });

    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ error: 'That is already your password', field: 'newPassword' });
    }

    await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { userId: user.userId },
      UpdateExpression: 'SET password = :p, passwordChangedAt = :t',
      ExpressionAttributeValues: {
        ':p': await bcrypt.hash(newPassword, 10),
        ':t': new Date().toISOString(),
      },
    }));

    // Existing tokens stay valid until they expire — this project has no
    // token blacklist, and saying so is better than implying otherwise.
    res.json({ message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/me — current account state, so the UI can refresh its banner. */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const found = await docClient.send(new GetCommand({
      TableName: TABLES.USERS,
      Key: { userId: req.user.userId },
    }));
    if (!found.Item) return res.status(404).json({ error: 'Account not found' });
    res.json({ user: publicUser(found.Item) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
