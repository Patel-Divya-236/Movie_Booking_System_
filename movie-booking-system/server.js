require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

/**
 * CORS.
 *
 * The frontend is served from a different origin than this API once it lives
 * on Vercel, so the browser demands an explicit allow. ALLOWED_ORIGINS is a
 * comma-separated list; leaving it unset falls back to permissive, which is
 * what local development and the single-origin EC2 deployment already relied
 * on.
 *
 * No credentials:true here on purpose — auth travels in the Authorization
 * header, not a cookie, so the browser never needs to send credentials
 * cross-origin and we avoid the stricter rules that come with it.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors(allowedOrigins.length ? {
  origin(origin, cb) {
    // No Origin header means a same-origin or non-browser caller (curl, the
    // health check) — those are not what CORS is protecting against.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    // Refuse by withholding the header, not by throwing: an Error here becomes
    // a 500, which looks like a server fault and tells the caller nothing.
    // Omitting the header is what CORS expects — the browser blocks it.
    console.warn(`CORS: refused origin ${origin}`);
    cb(null, false);
  },
} : {}));
app.use(express.json({ limit: '256kb' }));

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API
app.use('/api/config', require('./routes/config'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/movies', require('./routes/movies'));
app.use('/api/theatres', require('./routes/theatres'));
app.use('/api/shows', require('./routes/shows'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/support', require('./routes/support'));
app.use('/api/reviews', require('./routes/reviews'));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    dynamo: process.env.DYNAMODB_ENDPOINT || 'aws',
    // Which mail providers are usable, so a delivery problem can be diagnosed
    // without reading the logs.
    mail: require('./services/mailer').providers(),
  });
});

// Unknown API route — answer with JSON rather than falling through to the SPA,
// which would otherwise return index.html and confuse the client's res.json().
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Central error handler. Route handlers throw (or call next(err)) with an
 * optional `status`; anything unexpected becomes a 500 and is logged in full
 * without leaking internals to the client.
 */
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  if (status >= 500) {
    console.error(`💥 ${req.method} ${req.originalUrl}`, err);
  }
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on our end' : err.message,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 CineCloud running at http://localhost:${PORT}`);
  console.log(`   Frontend : http://localhost:${PORT}`);
  console.log(`   API      : http://localhost:${PORT}/api`);
  console.log(`   DynamoDB : ${process.env.DYNAMODB_ENDPOINT || 'AWS (' + (process.env.AWS_REGION || 'us-east-1') + ')'}\n`);
});
