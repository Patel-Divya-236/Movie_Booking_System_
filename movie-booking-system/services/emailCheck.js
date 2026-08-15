/**
 * Domain deliverability check.
 *
 * Format validation only proves an address is well-formed — "asdf@qwerty.zzz"
 * passes every regex. Looking up the domain's MX records proves something
 * stronger: that a mail server actually exists to receive it. That is what
 * stops invented domains at the signup form.
 *
 * It cannot tell whether a specific mailbox exists — "xyz@gmail.com" has
 * perfectly good MX records. Only email verification proves ownership.
 */

const dns = require('dns').promises;

// Domains are stable, and a signup form may check the same one repeatedly.
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 4000;

/** Well-known providers, short-circuited so signup never waits on DNS. */
const KNOWN_GOOD = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'icloud.com', 'me.com',
  'protonmail.com', 'proton.me', 'zoho.com', 'zohomail.in',
  'rediffmail.com', 'aol.com', 'gmx.com', 'mail.com', 'yandex.com',
]);

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), ms)),
  ]);
}

/**
 * @param {string} domain
 * @returns {Promise<{deliverable: boolean, reason?: string, checked: boolean}>}
 */
async function canReceiveMail(domain) {
  const key = String(domain || '').toLowerCase();
  if (!key) return { deliverable: false, reason: 'no domain', checked: true };

  if (KNOWN_GOOD.has(key)) return { deliverable: true, checked: false };

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.result, cached: true };

  let result;
  try {
    const mx = await withTimeout(dns.resolveMx(key), LOOKUP_TIMEOUT_MS);
    if (mx && mx.length > 0) {
      result = { deliverable: true, checked: true };
    } else {
      // A domain with no MX can still accept mail on its A record, so fall
      // back to that before calling it undeliverable.
      try {
        await withTimeout(dns.resolve4(key), LOOKUP_TIMEOUT_MS);
        result = { deliverable: true, checked: true, note: 'no MX, has A record' };
      } catch {
        result = { deliverable: false, reason: 'no mail server', checked: true };
      }
    }
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'NXDOMAIN') {
      result = { deliverable: false, reason: 'domain does not exist', checked: true };
    } else if (err.code === 'ENODATA') {
      try {
        await withTimeout(dns.resolve4(key), LOOKUP_TIMEOUT_MS);
        result = { deliverable: true, checked: true, note: 'no MX, has A record' };
      } catch {
        result = { deliverable: false, reason: 'no mail server', checked: true };
      }
    } else {
      // A DNS timeout or our own network trouble is not the user's fault —
      // let them through rather than blocking a legitimate signup.
      console.warn(`MX lookup for ${key} failed (${err.message}) — allowing`);
      result = { deliverable: true, checked: false, note: 'lookup unavailable' };
    }
  }

  cache.set(key, { at: Date.now(), result });
  return result;
}

module.exports = { canReceiveMail, KNOWN_GOOD };
