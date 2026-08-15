const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });

  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Malformed token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Populate req.user when a valid token is present, but let the request through
 * either way. For pages that are public but show more to a signed-in viewer —
 * the ratings block reads the same for everyone, yet only a signed-in booker
 * is offered the star control. A bad or expired token is treated as anonymous
 * rather than rejected, so a stale tab still renders the public view.
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.split(' ')[1];
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      // Anonymous.
    }
  }
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authenticate, optionalAuth, adminOnly };
