/**
 * Signup validation rules.
 *
 * Shared between the server (authoritative) and the browser (instant
 * feedback), so a user is never told something is fine and then rejected on
 * submit. The browser copy is served via GET /api/config.
 *
 * Two different problems are being solved here, and it is worth keeping them
 * apart:
 *
 *   1. "asdf@qwerty.zzz" — a domain that cannot receive mail at all. Caught
 *      here and by the MX lookup in services/emailCheck.js, with an inline
 *      error on the form.
 *
 *   2. "xyz@gmail.com" — a perfectly valid address that simply is not the
 *      user's. No amount of format checking catches that; only email
 *      verification does, because the link never reaches them.
 */

const PASSWORD_RULES = {
  minLength: 8,
  maxLength: 128,
  requireLetter: true,
  requireNumber: true,
  // A symbol is encouraged and scored, but not required — mandating one tends
  // to push people towards "Password1!" rather than anything actually strong.
  recommendSymbol: true,
};

/** Passwords common enough that an attacker tries them first. */
const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', 'abc12345', 'admin123', 'iloveyou', 'welcome1',
  'letmein1', 'football1', 'monkey123', 'sunshine1', 'princess1', 'passw0rd',
  'cinecloud', 'cinecloud1', 'movie123', 'booking123', 'test1234', 'asdf1234',
  'india123', 'krishna123', 'sairam123',
]);

/** Throwaway inbox providers — an address here cannot be contacted later. */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', 'temp-mail.org', 'guerrillamail.com',
  '10minutemail.com', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
  'sharklasers.com', 'getnada.com', 'maildrop.cc', 'fakeinbox.com',
  'dispostable.com', 'mailnesia.com', 'tempinbox.com', 'emailondeck.com',
  'moakt.com', 'mohmal.com', 'harakirimail.com', 'spam4.me',
]);

/** Near-misses for popular providers, so a typo gets a suggestion. */
const DOMAIN_TYPOS = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com', 'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmail.cm': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.om': 'gmail.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmil.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com',
  'rediffmail.co': 'rediffmail.com', 'protonmai.com': 'protonmail.com',
};

// Deliberately not the full RFC 5322 grammar — that accepts addresses no real
// mail system uses. This matches what people actually type.
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;

/**
 * Synchronous email checks — format, domain shape, known-bad domains.
 * @returns {{valid: boolean, error?: string, suggestion?: string, domain?: string}}
 */
function validateEmail(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();

  if (!email) return { valid: false, error: 'Enter your email address' };
  if (email.length > 254) return { valid: false, error: 'That email address is too long' };
  if (!email.includes('@')) return { valid: false, error: 'An email address needs an @ sign' };
  if ((email.match(/@/g) || []).length > 1) {
    return { valid: false, error: 'An email address can only contain one @' };
  }

  const [local, domain] = email.split('@');
  if (!local) return { valid: false, error: 'Add the part before the @' };
  if (!domain) return { valid: false, error: 'Add the part after the @, e.g. gmail.com' };
  if (!domain.includes('.')) {
    return { valid: false, error: `"${domain}" is not a complete domain — did you mean ${domain}.com?` };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { valid: false, error: 'That does not look like a valid email address' };
  }
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return { valid: false, error: 'The part before the @ has a misplaced dot' };
  }

  if (DOMAIN_TYPOS[domain]) {
    return {
      valid: false,
      error: `Did you mean ${local}@${DOMAIN_TYPOS[domain]}?`,
      suggestion: `${local}@${DOMAIN_TYPOS[domain]}`,
    };
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, error: 'Temporary email addresses are not accepted — please use a permanent one' };
  }

  const tld = domain.split('.').pop();
  if (tld.length < 2) return { valid: false, error: 'That domain ending does not look right' };

  return { valid: true, domain, email };
}

/**
 * Password strength.
 * @param {string} password
 * @param {object} context  { email, name } — so a password can't just be the user's own details
 * @returns {{valid: boolean, error?: string, score: number, label: string, checks: object}}
 */
function validatePassword(password, context = {}) {
  const pw = String(password || '');
  const checks = {
    length: pw.length >= PASSWORD_RULES.minLength,
    letter: /[a-zA-Z]/.test(pw),
    number: /\d/.test(pw),
    symbol: /[^a-zA-Z0-9]/.test(pw),
    mixedCase: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
  };

  // Score first, so the meter can move even while the password is invalid.
  let score = 0;
  if (checks.length) score++;
  if (pw.length >= 12) score++;
  if (checks.letter && checks.number) score++;
  if (checks.symbol) score++;
  if (checks.mixedCase) score++;
  score = Math.min(score, 4);

  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const result = { score, label: labels[score], checks };

  if (!pw) return { ...result, valid: false, error: 'Choose a password' };
  if (pw.length < PASSWORD_RULES.minLength) {
    return { ...result, valid: false, error: `Use at least ${PASSWORD_RULES.minLength} characters` };
  }
  if (pw.length > PASSWORD_RULES.maxLength) {
    return { ...result, valid: false, error: 'That password is too long' };
  }
  if (!checks.letter) return { ...result, valid: false, error: 'Include at least one letter' };
  if (!checks.number) return { ...result, valid: false, error: 'Include at least one number' };

  if (WEAK_PASSWORDS.has(pw.toLowerCase())) {
    return { ...result, valid: false, score: 0, label: labels[0], error: 'That password is too common — pick something less predictable' };
  }
  if (/^(.)\1+$/.test(pw)) {
    return { ...result, valid: false, score: 0, label: labels[0], error: 'A password cannot be one repeated character' };
  }
  if (/^(?:0123456789|1234567890|abcdefgh|qwertyui)/i.test(pw)) {
    return { ...result, valid: false, score: 0, label: labels[0], error: 'Avoid straight keyboard or number sequences' };
  }

  // Their own name or email local-part is the first thing anyone would guess.
  const localPart = String(context.email || '').split('@')[0].toLowerCase();
  if (localPart.length >= 4 && pw.toLowerCase().includes(localPart)) {
    return { ...result, valid: false, error: 'Your password should not contain your email address' };
  }
  const name = String(context.name || '').trim().toLowerCase();
  if (name.length >= 4 && pw.toLowerCase().includes(name)) {
    return { ...result, valid: false, error: 'Your password should not contain your name' };
  }

  return { ...result, valid: true };
}

function validateName(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return { valid: false, error: 'Enter your name' };
  if (name.length < 2) return { valid: false, error: 'That name looks too short' };
  if (name.length > 60) return { valid: false, error: 'That name is too long' };
  if (!/[a-zA-Z]/.test(name)) return { valid: false, error: 'A name needs at least one letter' };
  return { valid: true, name };
}

module.exports = {
  PASSWORD_RULES,
  DISPOSABLE_DOMAINS,
  DOMAIN_TYPOS,
  EMAIL_PATTERN,
  validateEmail,
  validatePassword,
  validateName,
};
